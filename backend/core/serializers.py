from rest_framework import serializers
from .models import Property, Panorama, PropertyImage
from room_sim.models import ReconstructionJob


class PropertyImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyImage
        fields = ("id", "image_path", "is_thumbnail", "created_at")
        read_only_fields = ("id", "created_at")


class PanoramaSerializer(serializers.ModelSerializer):
    job_state = serializers.SerializerMethodField()
    has_cubemap_faces = serializers.SerializerMethodField()
    has_appliance_scan = serializers.SerializerMethodField()
    face_urls = serializers.SerializerMethodField()

    class Meta:
        model = Panorama
        fields = (
            "id", "property", "uploaded_by", "job_id", "status",
            "created_at", "completed_at", "error_message",
            "job_state", "has_cubemap_faces", "has_appliance_scan", "face_urls",
        )
        read_only_fields = ("id", "created_at", "completed_at", "job_id", "uploaded_by", "error_message")

    def _get_job(self, obj):
        if not obj.job_id:
            return None
        try:
            return ReconstructionJob.objects.get(pk=obj.job_id)
        except ReconstructionJob.DoesNotExist:
            return None

    def get_job_state(self, obj):
        job = self._get_job(obj)
        return job.state if job else None

    def get_has_cubemap_faces(self, obj):
        job = self._get_job(obj)
        return bool(job and (job.job_dir() / "cubemap_faces").is_dir())

    def get_has_appliance_scan(self, obj):
        job = self._get_job(obj)
        return bool(job and (job.job_dir() / "appliance_scans.json").is_file())

    def get_face_urls(self, obj):
        job = self._get_job(obj)
        if not job:
            return {}
        faces_dir = job.job_dir() / "cubemap_faces"
        if not faces_dir.is_dir():
            return {}
        return {
            face: f"/room-sim/api/jobs/{job.pk}/artifact/face/{face}/"
            for face in ("front", "back", "left", "right", "top", "bottom")
            if (faces_dir / f"{face}.jpg").is_file()
        }


class PropertyListSerializer(serializers.ModelSerializer):
    owner_id = serializers.IntegerField(source="owner.id", read_only=True)
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    owner_name = serializers.SerializerMethodField()
    panorama_count = serializers.SerializerMethodField()
    has_3d = serializers.SerializerMethodField()
    area_m2 = serializers.FloatField(required=False, allow_null=True)
    price_tnd = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    # Fields not collected by the basic AddPropertyModal form — all optional with model defaults
    building_mass = serializers.CharField(required=False, default="medium")
    building_age_years = serializers.IntegerField(required=False, default=10)
    natural_light = serializers.FloatField(required=False, default=0.6)
    internet_type = serializers.CharField(required=False, default="unknown")
    smoking_allowed = serializers.BooleanField(required=False, default=False)
    has_heating = serializers.BooleanField(required=False, default=False)
    has_balcony = serializers.BooleanField(required=False, default=False)
    has_internet = serializers.BooleanField(required=False, default=True)
    has_kitchen = serializers.BooleanField(required=False, default=True)
    has_cleaning_supplies = serializers.BooleanField(required=False, default=True)
    has_storage = serializers.BooleanField(required=False, default=False)
    has_security = serializers.BooleanField(required=False, default=False)
    has_windows = serializers.BooleanField(required=False, default=True)
    apt_configured = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = Property
        fields = (
            "id", "address", "description", "lat", "lng", "bedrooms", "bathrooms",
            "area_m2", "price_tnd", "for_sale", "for_rent",
            "floor_number", "orientation", "building_mass", "building_condition",
            "has_elevator", "has_cooling", "has_heating", "has_balcony",
            "has_internet", "has_kitchen", "has_cleaning_supplies", "has_parking",
            "has_storage", "has_security", "has_windows", "furnished",
            "smoking_allowed", "natural_light", "building_age_years",
            "internet_type", "apt_configured",
            "owner_id", "owner_email", "owner_name",
            "panorama_count", "has_3d", "created_at",
        )
        read_only_fields = ("id", "created_at", "owner_id", "owner_email", "owner_name")

    def create(self, validated_data):
        validated_data["owner"] = self.context["request"].user
        return super().create(validated_data)

    def get_panorama_count(self, obj):
        return obj.panoramas.filter(status="completed").count()

    def get_owner_name(self, obj):
        u = obj.owner
        return u.get_full_name().strip() or u.username or u.email.split("@")[0]

    def get_has_3d(self, obj):
        return obj.reconstruction_jobs.filter(state="completed").exists()



class PropertyDetailSerializer(serializers.ModelSerializer):
    owner_id = serializers.IntegerField(source="owner.id", read_only=True)
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    panoramas = PanoramaSerializer(many=True, read_only=True)
    images = PropertyImageSerializer(many=True, read_only=True)
    has_3d = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = (
            "id", "owner_id", "owner_email", "address", "lat", "lng",
            "bedrooms", "bathrooms", "area_m2", "price_tnd",
            "for_sale", "for_rent", "description", "is_active",
            "created_at", "updated_at", "panoramas", "images", "has_3d",
        )
        read_only_fields = (
            "id", "created_at", "updated_at",
            "owner_id", "owner_email", "panoramas", "images",
        )

    def get_has_3d(self, obj):
        return obj.reconstruction_jobs.filter(state="completed").exists()

    def create(self, validated_data):
        validated_data["owner"] = self.context["request"].user
        return super().create(validated_data)
