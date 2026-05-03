import urllib.request
import urllib.parse
import json as json_module
import hashlib

from django.core.cache import cache
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework_simplejwt.authentication import JWTAuthentication
from pathlib import Path
from datetime import datetime, timezone

from django.conf import settings
from django.shortcuts import get_object_or_404

from .models import Property, Panorama, PropertyInterest
from .serializers import PropertyListSerializer, PropertyDetailSerializer, PanoramaSerializer
from users.models import UserPersona
from room_sim.models import ReconstructionJob
from room_sim.pipeline.runner import submit_pipeline_job


class PropertyViewSet(viewsets.ModelViewSet):
    """
    Full CRUD for Property records.
    Accepts JSON for create/update (default DRF parsers).
    File uploads go through the separate PanoramaUploadView which has its own parsers.
    """
    permission_classes = (IsAuthenticatedOrReadOnly,)
    authentication_classes = (JWTAuthentication,)
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
                property=property_obj,
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


class PropertyInterestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, property_id):
        """Toggle current user's interest in a property."""
        prop = get_object_or_404(Property, pk=property_id)
        obj, created = PropertyInterest.objects.get_or_create(user=request.user, property=prop)
        if not created:
            obj.delete()
            return Response({"interested": False})
        return Response({"interested": True}, status=status.HTTP_201_CREATED)

    def get(self, request, property_id):
        """List users interested in a property (id, display_name, has_persona)."""
        prop = get_object_or_404(Property, pk=property_id)
        interests = PropertyInterest.objects.filter(property=prop).select_related("user")
        data = []
        for i in interests:
            u = i.user
            data.append({
                "id": u.id,
                "email": u.email,
                "display_name": u.get_full_name() or u.username or u.email.split("@")[0],
                "has_persona": UserPersona.objects.filter(user=u).exists(),
                "is_me": u == request.user,
            })
        # Also report whether current user is interested
        me_interested = PropertyInterest.objects.filter(property=prop, user=request.user).exists()
        return Response({"interested_users": data, "i_am_interested": me_interested})


class OverpassProxyView(APIView):
    """
    Server-side proxy for the Overpass API.
    Avoids CORS issues when the frontend is served from a non-standard origin
    (e.g. VS Code / GitHub dev tunnels).
    POST body: { "query": "<overpass QL string>" }
    """
    permission_classes = []  # Public — Overpass data is public anyway

    ENDPOINTS = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]

    def post(self, request, *args, **kwargs):
        query = request.data.get("query", "")
        if not query:
            return Response({"error": "Missing 'query' field."}, status=status.HTTP_400_BAD_REQUEST)

        cache_key = "overpass_" + hashlib.md5(query.encode("utf-8")).hexdigest()
        cached_data = cache.get(cache_key)
        if cached_data:
            return Response(cached_data)

        body = ("data=" + urllib.parse.quote(query)).encode("utf-8")
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "HestIA/1.0 (real-estate app; contact@hestia.tn)",
            "Accept": "application/json",
        }

        for endpoint in self.ENDPOINTS:
            try:
                req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=12) as resp:
                    data = json_module.loads(resp.read().decode("utf-8"))
                    cache.set(cache_key, data, timeout=300)  # cache for 5 minutes
                    return Response(data)
            except Exception:
                continue  # Try next mirror

        return Response({"error": "All Overpass mirrors failed."}, status=status.HTTP_502_BAD_GATEWAY)
