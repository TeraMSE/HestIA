from django.urls import path
from . import views

urlpatterns = [
    path("health/",                   views.HealthView.as_view(),          name="appliances-health"),
    path("analyze/",                  views.AnalyzeView.as_view(),          name="appliances-analyze"),
    path("analyze/multiple/",         views.AnalyzeMultipleView.as_view(),  name="appliances-analyze-multiple"),
    path("rule-engine/table/",        views.RuleEngineTableView.as_view(),  name="appliances-rule-table"),
    path("search-specs/",             views.SearchSpecsView.as_view(),      name="appliances-search-specs"),
    path("<int:pk>/report/pdf/",      views.ReportPdfView.as_view(),        name="appliances-report-pdf"),
    path("<int:pk>/invoice/steg/",    views.StegInvoiceView.as_view(),      name="appliances-steg-invoice"),
    path("scan-from-job/<uuid:job_id>/", views.ScanFromJobView.as_view(),      name="appliances-scan-from-job"),
    path("",                             views.ScanListView.as_view(),          name="appliances-scan-list"),
]
