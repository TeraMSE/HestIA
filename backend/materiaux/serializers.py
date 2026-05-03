from rest_framework import serializers
from .models import MaterialEstimate


class MaterialEstimateListSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaterialEstimate
        fields = [
            "id", "region", "gamme", "budget_tnd", "surface_m2",
            "nb_chambres", "cout_total_tnd", "created_at",
        ]


class MaterialEstimateDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaterialEstimate
        fields = "__all__"
