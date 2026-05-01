from rest_framework import serializers
from .models import Property, Panorama, PropertyImage
from room_sim.models import ReconstructionJob


class PropertyImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyImage
        fields = ("id", "image_path", "is_thumbnail", "created_at")
        read_only_fields = ("id", "created_at")


class PanoramaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Panorama
        fields = ("id", "property", "uploaded_by", "job_id", "status", "created_at", "completed_at", "error_message")
        read_only_fields = ("id", "created_at", "completed_at", "job_id", "uploaded_by", "error_message")


class PropertyListSerializer(serializers.ModelSerializer):
    owner_id = serializers.IntegerField(source="owner.id", read_only=True)
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    owner_name = serializers.SerializerMethodField()
    panorama_count = serializers.SerializerMethodField()
    has_3d = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = (
            "id", "address", "lat", "lng", "bedrooms", "bathrooms",
            "area_m2", "price_tnd", "for_sale", "for_rent",
            "owner_id", "owner_email", "owner_name",
            "panorama_count", "has_3d", "created_at",
        )
        read_only_fields = ("id", "created_at", "owner_id", "owner_email", "owner_name")

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
