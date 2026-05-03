from rest_framework import serializers
from .models import Appliance, ApplianceScan


class ApplianceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Appliance
        fields = [
            "id", "detected_class", "confidence", "etat_visuel",
            "age_years", "energy_class", "brand", "technology", "kwh_per_year",
            "efficiency_score", "grade", "score_details", "created_at",
        ]


class ApplianceScanSerializer(serializers.ModelSerializer):
    appliances = ApplianceSerializer(many=True, read_only=True)

    class Meta:
        model = ApplianceScan
        fields = ["id", "global_score", "grade", "appliances", "created_at"]
