import uuid
from django.db import models
from django.conf import settings


class Property(models.Model):
    ORIENTATION_CHOICES = [
        ("north", "North"), ("south", "South"), ("east", "East"),
        ("west", "West"), ("unknown", "Unknown"),
    ]
    BUILDING_MASS_CHOICES = [
        ("heavy", "Heavy"), ("medium", "Medium"), ("light", "Light"),
    ]
    BUILDING_CONDITION_CHOICES = [
        ("new", "New"), ("good", "Good"), ("fair", "Fair"), ("poor", "Poor"),
    ]

    id = models.BigAutoField(primary_key=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="properties")
    address = models.CharField(max_length=255)
    lat = models.DecimalField(max_digits=10, decimal_places=8)
    lng = models.DecimalField(max_digits=11, decimal_places=8)
    bedrooms = models.IntegerField(default=1)
    bathrooms = models.IntegerField(default=1)
    area_m2 = models.FloatField(null=True, blank=True)
    price_tnd = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    for_sale = models.BooleanField(default=True)
    for_rent = models.BooleanField(default=False)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ── Apartment configuration (for life simulation) ──────────────────────────
    floor_number = models.IntegerField(default=1)
    orientation = models.CharField(
        max_length=10, choices=ORIENTATION_CHOICES, default="unknown"
    )
    building_mass = models.CharField(
        max_length=10, choices=BUILDING_MASS_CHOICES, default="heavy"
    )
    building_condition = models.CharField(
        max_length=10, choices=BUILDING_CONDITION_CHOICES, default="good"
    )
    has_elevator = models.BooleanField(default=False)
    has_cooling = models.BooleanField(default=False)
    has_heating = models.BooleanField(default=False)
    has_balcony = models.BooleanField(default=False)
    has_internet = models.BooleanField(default=True)
    has_kitchen = models.BooleanField(default=True)
    has_cleaning_supplies = models.BooleanField(default=True)
    has_parking = models.BooleanField(default=False)
    has_storage = models.BooleanField(default=False)
    has_security = models.BooleanField(default=False)
    has_windows = models.BooleanField(default=True)
    furnished = models.BooleanField(default=False)
    smoking_allowed = models.BooleanField(default=False)
    natural_light = models.FloatField(default=0.6)
    building_age_years = models.IntegerField(default=10)
    internet_type = models.CharField(
        max_length=16,
        choices=[("fiber", "Fiber"), ("adsl", "ADSL"), ("mobile", "Mobile"), ("none", "None"), ("unknown", "Unknown")],
        default="unknown",
    )
    apt_configured = models.BooleanField(default=False)  # True once landlord fills form

    # ── Cached assessment flags (set True after each pipeline step completes) ──
    noise_assessed = models.BooleanField(default=False)
    thermal_assessed = models.BooleanField(default=False)
    neighbourhood_scanned = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Property"
        verbose_name_plural = "Properties"

    def __str__(self):
        return f"{self.address} - {self.owner.email}"


class Panorama(models.Model):
    STATUS_CHOICES = [
        ("uploading", "Uploading"),
        ("processing", "Processing"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    id = models.BigAutoField(primary_key=True)
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="panoramas")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="uploaded_panoramas")
    job_id = models.UUIDField(null=True, blank=True)
    file_path = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="uploading")
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Panorama"
        verbose_name_plural = "Panoramas"

    def __str__(self):
        return f"Panorama for {self.property.address}"


class PropertyInterest(models.Model):
    """Tracks which users have marked interest in a property (for multiplayer sim)."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="property_interests"
    )
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, related_name="interested_users"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "property")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.email} interested in {self.property.address}"


class PropertyImage(models.Model):
    id = models.BigAutoField(primary_key=True)
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="images")
    image_path = models.CharField(max_length=255)
    is_thumbnail = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Property Image"
        verbose_name_plural = "Property Images"

    def __str__(self):
        return f"Image for {self.property.address}"
