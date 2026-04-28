from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.parsers import MultiPartParser, FormParser
from pathlib import Path
from datetime import datetime, timezone

from django.conf import settings
from django.shortcuts import get_object_or_404

from .models import Property, Panorama
from .serializers import PropertyListSerializer, PropertyDetailSerializer, PanoramaSerializer
from room_sim.models import ReconstructionJob
from room_sim.pipeline.runner import submit_pipeline_job


class PropertyViewSet(viewsets.ModelViewSet):
    permission_classes = (IsAuthenticatedOrReadOnly,)
    parser_classes = (MultiPartParser, FormParser)
    filterset_fields = ("for_sale", "for_rent", "is_active")
    search_fields = ("address", "owner__email")
    ordering_fields = ("created_at", "price_tnd")
    ordering = ("-created_at",)

    def get_queryset(self):
        return Property.objects.filter(is_active=True)

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PropertyDetailSerializer
        return PropertyListSerializer

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_update(self, serializer):
        if serializer.instance.owner != self.request.user:
            return Response(
                {"detail": "You do not have permission to update this property."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer.save()

    @action(detail=False, methods=["get"])
    def my_properties(self, request):
        """Get properties owned by the current user."""
        properties = Property.objects.filter(owner=request.user, is_active=True)
        serializer = self.get_serializer(properties, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def panoramas(self, request, pk=None):
        """Get panoramas for a specific property."""
        property_obj = self.get_object()
        panoramas = property_obj.panoramas.all()
        serializer = PanoramaSerializer(panoramas, many=True)
        return Response(serializer.data)


class PanoramaUploadView(APIView):
    permission_classes = (IsAuthenticated,)
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        """Upload panorama and start reconstruction job."""
        try:
            property_id = request.data.get("property_id")
            image_file = request.FILES.get("image")

            if not property_id or not image_file:
                return Response(
                    {"error": "Missing 'property_id' or 'image' file"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            property_obj = get_object_or_404(Property, id=property_id)
            if property_obj.owner != request.user:
                return Response(
                    {"detail": "You do not have permission to upload to this property."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            suffix = Path(image_file.name).suffix.lower()
            if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
                return Response(
                    {"error": "Only png/jpg/jpeg/webp allowed"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            align_panorama = request.data.get("align_panorama", "true").lower() == "true"
            force_cuboid = request.data.get("force_cuboid", "false").lower() == "true"
            mesh_stride = int(request.data.get("mesh_stride", "2"))
            ignore_ceiling = request.data.get("ignore_ceiling", "true").lower() == "true"
            checkpoint = request.data.get("checkpoint", "")

            job = ReconstructionJob.objects.create(
                state="queued",
                current_step="queued",
                align_panorama=align_panorama,
                force_cuboid=force_cuboid,
                mesh_stride=mesh_stride,
                ignore_ceiling=ignore_ceiling,
                checkpoint_path=checkpoint,
            )

            job_dir = job.job_dir()
            input_dir = job_dir / "input"
            input_dir.mkdir(parents=True, exist_ok=True)
            input_path = input_dir / f"panorama{suffix}"

            with input_path.open("wb") as f:
                for chunk in image_file.chunks():
                    f.write(chunk)

            panorama = Panorama.objects.create(
                property=property_obj,
                uploaded_by=request.user,
                job_id=job.id,
                file_path=str(input_path),
                status="processing",
            )

            ckpt_path = settings.CHECKPOINT_PATH
            if checkpoint:
                ckpt_path = Path(checkpoint)
                if not ckpt_path.is_absolute():
                    ckpt_path = settings.BASE_DIR / ckpt_path
            if not ckpt_path.is_file():
                job.state = "failed"
                job.error_message = f"Checkpoint not found: {ckpt_path}"
                job.save()
                panorama.status = "failed"
                panorama.error_message = job.error_message
                panorama.save()
                return Response(
                    {"error": job.error_message},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            submit_pipeline_job(str(job.id), ckpt_path)

            return Response(
                {
                    "id": panorama.id,
                    "property_id": property_obj.id,
                    "job_id": str(job.id),
                    "status": "processing",
                    "status_url": f"/api/jobs/{job.id}/status/",
                    "created_at": panorama.created_at.isoformat(),
                },
                status=status.HTTP_202_ACCEPTED,
            )

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
