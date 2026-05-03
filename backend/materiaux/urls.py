from django.urls import path
from . import views

urlpatterns = [
    path("regions/", views.RegionsView.as_view(), name="materiaux-regions"),
    path("gammes/", views.GammesView.as_view(), name="materiaux-gammes"),
    path("catalogue/", views.CatalogueView.as_view(), name="materiaux-catalogue"),
    path("catalogue/categories/", views.CatalogueCategoriesView.as_view(), name="materiaux-catalogue-categories"),
    path("cout-reference/", views.CoutReferenceView.as_view(), name="materiaux-cout-reference"),
    path("analyser-plan/", views.AnalyserPlanView.as_view(), name="materiaux-analyser-plan"),
    path("estimates/", views.EstimateListView.as_view(), name="materiaux-estimate-list"),
    path("estimates/<int:pk>/", views.EstimateDetailView.as_view(), name="materiaux-estimate-detail"),
]
