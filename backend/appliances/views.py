"""appliances/views.py — DRF views for the appliance energy efficiency endpoints."""

import io
import traceback

from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .apps import AppliancesConfig
from .models import Appliance, ApplianceScan
from core.services.grading import grade_from_score


def _get_agent():
    """Return the pre-loaded agent (or create one lazily if ready() failed)."""
    agent = AppliancesConfig._agent
    if agent is None:
        from .services.agent import ApplianceVisionAgent
        agent = ApplianceVisionAgent(
            model_path=str(settings.APPLIANCE_CNN_PATH),
            class_names_path=str(settings.BASE_DIR / "appliances" / "data" / "class_names.json"),
        )
        AppliancesConfig._agent = agent
    return agent


class HealthView(APIView):
    def get(self, request):
        return Response({"status": "ok", "service": "Appliance Energy Efficiency"})


class AnalyzeView(APIView):
    """Single appliance analysis — persists one Appliance row."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        try:
            photo_file = request.FILES.get("photo")
            if not photo_file:
                return Response({"detail": "No photo provided."}, status=status.HTTP_400_BAD_REQUEST)

            age = request.data.get("age")
            energy_class = request.data.get("energy_class", "")
            brand = request.data.get("brand", "")
            technology = request.data.get("technology", "")
            kwh_per_year = request.data.get("kwh_per_year")
            property_id = request.query_params.get("property_id")

            # 1. Save the photo to media root via Appliance model
            property_obj = None
            if property_id:
                try:
                    from core.models import Property
                    property_obj = Property.objects.get(pk=int(property_id))
                except Exception:
                    pass

            appliance_obj = Appliance.objects.create(
                user=request.user,
                property=property_obj,
                photo=photo_file,
                age_years=int(age) if age else None,
                energy_class=energy_class,
                brand=brand,
                technology=technology,
                kwh_per_year=int(kwh_per_year) if kwh_per_year else None,
            )

            # 2. Run CNN + state detection + rule engine
            agent = _get_agent()
            from .services.state_detector import detect_state
            from .services.rule_engine import ApplianceRuleEngine

            photo_path = appliance_obj.photo.path
            cnn_result = agent.predict_image(photo_path)
            detected_class = cnn_result["class"]
            confidence = cnn_result["confidence"]
            etat_visuel = detect_state(photo_path)

            rule_engine = ApplianceRuleEngine()
            appliance_data = [{
                "category": detected_class,
                "age": int(age) if age else 7,
                "confidence": confidence,
                "energy_class": energy_class or "C",
                "brand": brand or "generique",
                "technology": technology or "standard",
                "kwh_per_year": int(kwh_per_year) if kwh_per_year else None,
                "etat_visuel": etat_visuel,
            }]
            score, scores, details = rule_engine.calculate_score(appliance_data)
            grade = rule_engine.get_grade(score)

            # 3. Persist result
            appliance_obj.detected_class = detected_class
            appliance_obj.confidence = confidence
            appliance_obj.etat_visuel = etat_visuel
            appliance_obj.efficiency_score = score
            appliance_obj.grade = grade
            appliance_obj.score_details = details
            appliance_obj.save()

            return Response({
                "appliance_id": appliance_obj.pk,
                "detected_class": detected_class,
                "confidence": round(confidence, 4),
                "etat_visuel": etat_visuel,
                "efficiency_score": round(score, 2),
                "grade": grade,
                "score_details": details,
            })
        except Exception as exc:
            traceback.print_exc()
            return Response({"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AnalyzeMultipleView(APIView):
    """Batch analysis — creates ApplianceScan + multiple Appliance rows."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        try:
            photos = request.FILES.getlist("photos")
            if not photos:
                return Response({"detail": "No photos provided."}, status=status.HTTP_400_BAD_REQUEST)

            property_id = request.query_params.get("property_id")
            property_obj = None
            if property_id:
                try:
                    from core.models import Property
                    property_obj = Property.objects.get(pk=int(property_id))
                except Exception:
                    pass

            agent = _get_agent()
            from .services.state_detector import detect_state
            from .services.rule_engine import ApplianceRuleEngine
            rule_engine = ApplianceRuleEngine()

            appliance_objects = []
            appliance_data_list = []

            for i, photo_file in enumerate(photos):
                age = request.data.get(f"age_{i}")
                energy_class = request.data.get(f"energy_class_{i}", "")
                brand = request.data.get(f"brand_{i}", "")
                technology = request.data.get(f"technology_{i}", "")
                kwh_per_year = request.data.get(f"kwh_per_year_{i}")

                obj = Appliance.objects.create(
                    user=request.user,
                    property=property_obj,
                    photo=photo_file,
                    age_years=int(age) if age else None,
                    energy_class=energy_class,
                    brand=brand,
                    technology=technology,
                    kwh_per_year=int(kwh_per_year) if kwh_per_year else None,
                )

                cnn_result = agent.predict_image(obj.photo.path)
                detected_class = cnn_result["class"]
                confidence = cnn_result["confidence"]
                etat_visuel = detect_state(obj.photo.path)

                appliance_data_list.append({
                    "category": detected_class,
                    "age": int(age) if age else 7,
                    "confidence": confidence,
                    "energy_class": energy_class or "C",
                    "brand": brand or "generique",
                    "technology": technology or "standard",
                    "kwh_per_year": int(kwh_per_year) if kwh_per_year else None,
                    "etat_visuel": etat_visuel,
                })

                score_i, _, details_i = rule_engine.calculate_score([appliance_data_list[-1]])
                grade_i = rule_engine.get_grade(score_i)
                obj.detected_class = detected_class
                obj.confidence = confidence
                obj.etat_visuel = etat_visuel
                obj.efficiency_score = score_i
                obj.grade = grade_i
                obj.score_details = details_i
                obj.save()
                appliance_objects.append(obj)

            global_score, _, _ = rule_engine.calculate_score(appliance_data_list)
            global_grade = rule_engine.get_grade(global_score)

            scan = ApplianceScan.objects.create(
                user=request.user,
                property=property_obj,
                global_score=global_score,
                grade=global_grade,
            )
            scan.appliances.set(appliance_objects)

            return Response({
                "scan_id": scan.pk,
                "global_score": round(global_score, 2),
                "grade": global_grade,
                "appliances": [
                    {"id": obj.pk, "detected_class": obj.detected_class,
                     "efficiency_score": round(obj.efficiency_score, 2), "grade": obj.grade}
                    for obj in appliance_objects
                ],
            })
        except Exception as exc:
            traceback.print_exc()
            return Response({"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class RuleEngineTableView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .services.rule_engine import ApplianceRuleEngine
        engine = ApplianceRuleEngine()
        return Response({"scoring_table": getattr(engine, "scoring_table", {})})


class SearchSpecsView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser]

    def post(self, request):
        try:
            from .services.web_search import search_appliance_specs
            brand = request.data.get("brand", "")
            model = request.data.get("model", "")
            category = request.data.get("category", "")
            result = search_appliance_specs(brand=brand, model_name=model, category=category)
            return Response(result)
        except Exception as exc:
            traceback.print_exc()
            return Response({"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ReportPdfView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            appliance = Appliance.objects.get(pk=pk, user=request.user)
        except Appliance.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        try:
            from .services.report_generator import generate_report
            from .services.pdf_generator import generate_pdf

            score_details = appliance.score_details.get(appliance.detected_class, appliance.score_details)
            report_text = generate_report(
                category=appliance.detected_class,
                score=appliance.efficiency_score,
                grade=appliance.grade,
                details=score_details,
            )
            pdf_bytes = generate_pdf({
                "detected_class": appliance.detected_class,
                "age_years": appliance.age_years,
                "energy_class": appliance.energy_class,
                "brand": appliance.brand,
                "technology": appliance.technology,
                "kwh_per_year": appliance.kwh_per_year,
                "etat_visuel": appliance.etat_visuel,
                "efficiency_score": appliance.efficiency_score,
                "grade": appliance.grade,
                "confidence": appliance.confidence,
                "score_details": score_details,
                "recommendation": report_text,
            })
            response = HttpResponse(pdf_bytes, content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="appliance_report_{pk}.pdf"'
            return response
        except Exception as exc:
            traceback.print_exc()
            return Response({"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StegInvoiceView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            appliance = Appliance.objects.get(pk=pk, user=request.user)
        except Appliance.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        try:
            from .services.steg_invoice import generate_steg_invoice
            pdf_bytes = generate_steg_invoice({
                "detected_class": appliance.detected_class,
                "kwh_per_year": appliance.kwh_per_year or 1500,
                "efficiency_score": appliance.efficiency_score,
                "grade": appliance.grade,
                "brand": appliance.brand,
                "energy_class": appliance.energy_class,
                "etat_visuel": appliance.etat_visuel,
            })
            response = HttpResponse(pdf_bytes, content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="steg_invoice_{pk}.pdf"'
            return response
        except Exception as exc:
            traceback.print_exc()
            return Response({"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ScanListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scans = ApplianceScan.objects.filter(user=request.user)
        return Response([
            {
                "id": s.pk,
                "global_score": round(s.global_score, 2),
                "grade": s.grade,
                "created_at": s.created_at.isoformat(),
                "property_id": s.property_id,
                "nb_appliances": s.appliances.count(),
            }
            for s in scans
        ])


class ScanFromJobView(APIView):
    """
    POST /api/v1/appliances/scan-from-job/<job_id>/

    Runs (or retrieves cached) appliance scan from an existing completed
    reconstruction job's cubemap faces. No image upload needed — the
    panorama already went through the pipeline.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, job_id):
        import json as _json
        from room_sim.models import ReconstructionJob
        from room_sim.pipeline.appliance_scanner import scan_appliances

        try:
            job = ReconstructionJob.objects.get(pk=job_id)
        except ReconstructionJob.DoesNotExist:
            return Response({"detail": "Reconstruction job not found."}, status=status.HTTP_404_NOT_FOUND)

        if job.state != "completed":
            return Response(
                {"detail": f"Job is not completed yet (state: {job.state})."},
                status=status.HTTP_409_CONFLICT,
            )

        job_dir = job.job_dir()
        scans_path = job_dir / "appliance_scans.json"

        # Return cached result if already computed
        if scans_path.is_file():
            with open(scans_path, encoding="utf-8") as f:
                return Response(_json.load(f))

        faces_dir = job_dir / "cubemap_faces"
        if not faces_dir.is_dir():
            return Response(
                {"detail": "Cubemap faces not found for this job. The panorama may predate the current pipeline version."},
                status=status.HTTP_404_NOT_FOUND,
            )

        detections_path = job_dir / "detections.json"
        if not detections_path.is_file():
            return Response(
                {"detail": "Object detections not found for this job."},
                status=status.HTTP_404_NOT_FOUND,
            )

        with open(detections_path, encoding="utf-8") as f:
            detections = _json.load(f)

        log_lines: list[str] = []
        result = scan_appliances(job_dir, detections, faces_dir, log_lines.append)

        if result is None:
            return Response(
                {"detail": "No appliances detected in this panorama.", "log": log_lines},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(result)
