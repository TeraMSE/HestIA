import uuid
from django.db import models
from django.conf import settings


class Property(models.Model):
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
