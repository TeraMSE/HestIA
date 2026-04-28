from rest_framework import serializers
from .models import Property, Panorama, PropertyImage


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
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    panorama_count = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = ("id", "address", "lat", "lng", "bedrooms", "bathrooms", "area_m2", "price_tnd", "for_sale", "for_rent", "owner_email", "panorama_count", "created_at")
        read_only_fields = ("id", "created_at", "owner_email")

    def get_panorama_count(self, obj):
        return obj.panoramas.filter(status="completed").count()


class PropertyDetailSerializer(serializers.ModelSerializer):
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    panoramas = PanoramaSerializer(many=True, read_only=True)
    images = PropertyImageSerializer(many=True, read_only=True)

    class Meta:
        model = Property
        fields = ("id", "owner", "owner_email", "address", "lat", "lng", "bedrooms", "bathrooms", "area_m2", "price_tnd", "for_sale", "for_rent", "description", "is_active", "created_at", "updated_at", "panoramas", "images")
        read_only_fields = ("id", "created_at", "updated_at", "owner", "owner_email", "panoramas", "images")

    def create(self, validated_data):
        validated_data["owner"] = self.context["request"].user
        return super().create(validated_data)
