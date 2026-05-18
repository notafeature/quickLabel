"""Pydantic models — request/response shapes for the QuickLabel API."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Lineage (embedded on most lots)
# ---------------------------------------------------------------------------


class Lineage(BaseModel):
    f: Optional[int] = None
    c: Optional[int] = None
    iso: Optional[str] = None
    t: Optional[int] = None


# ---------------------------------------------------------------------------
# Registries
# ---------------------------------------------------------------------------


class RegistryEntry(BaseModel):
    code: str
    description: str


class IngestTypeEntry(BaseModel):
    code: str
    label: str
    derivative_kind: Optional[Literal["agar", "lc"]] = None


# ---------------------------------------------------------------------------
# Genetic codes
# ---------------------------------------------------------------------------


class GeneticCodeIn(BaseModel):
    code: str
    genus: str
    species: str
    cultivar: Optional[str] = None
    colonization_window_days: Optional[int] = None
    notes: Optional[str] = None


class GeneticCodeOut(GeneticCodeIn):
    id: str
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Event input shapes
# ---------------------------------------------------------------------------


class EventBase(BaseModel):
    event_date: Optional[str] = None
    operator_id: Optional[str] = None
    client_id: Optional[str] = None
    notes: Optional[str] = None
    photo_refs: list[str] = Field(default_factory=list)


# Ingest


class IngestEventIn(EventBase):
    genetic_code_id: str
    ingest_type: str
    external_source: Optional[str] = None
    lineage: Lineage = Field(default_factory=Lineage)
    received_date: Optional[str] = None
    # Derivative-lot fields (used when ingest_type implies a derivative lot)
    plate_size: Optional[str] = None
    agar_formula: Optional[str] = None
    vessel_type: Optional[str] = None
    initial_volume_ml: Optional[float] = None


# Agar


class PlateAgarIn(EventBase):
    genetic_code_id: str
    source: Optional["SourceRef"] = None
    lineage: Lineage = Field(default_factory=Lineage)
    agar_formula: Optional[str] = None
    plate_size: Optional[str] = None


class DrawAgarIn(EventBase):
    parent_agar_id: str
    fraction: float = Field(gt=0, le=1)
    plate_size: Optional[str] = None
    agar_formula: Optional[str] = None  # defaults to parent's
    lineage: Optional[Lineage] = None    # defaults to parent's


# LC


class PlateLCIn(EventBase):
    genetic_code_id: str
    source: Optional["SourceRef"] = None
    lineage: Lineage = Field(default_factory=Lineage)
    vessel_type: Optional[str] = None
    initial_volume_ml: float = Field(gt=0)


class DrawLCIn(EventBase):
    parent_lc_id: str
    amount_ml: float = Field(gt=0)
    vessel_type: Optional[str] = None
    lineage: Optional[Lineage] = None


# Grain


class SterilizeGrainIn(EventBase):
    grain_type: str
    prep_size: Optional[str] = None
    count: int = Field(default=1, ge=1)  # batch sterilization → N sterile bags


class InoculateGrainIn(EventBase):
    grain_lot_id: str  # sterile GrainLot being inoculated
    source: "SourceRef"
    genetic_code_id: str
    lineage: Lineage = Field(default_factory=Lineage)


# Spawn to Bulk


class SpawnToBulkInputRef(BaseModel):
    grain_lot_id: str
    fraction: float = Field(default=1.0, gt=0, le=1)


class SpawnToBulkIn(EventBase):
    grain_inputs: list[SpawnToBulkInputRef]
    recipe_id: str
    recipe_overrides: dict[str, Any] = Field(default_factory=dict)
    bulk_mass: Optional[float] = None
    bulk_mass_unit: Optional[str] = None
    container_count: Optional[int] = None
    location: Optional[str] = None


# Harvest


class HarvestIn(EventBase):
    batch_id: str
    wet_weight: Optional[float] = None
    wet_weight_unit: Optional[str] = "g"


class DryIn(EventBase):
    harvest_lot_id: str
    dry_weight: float
    dry_weight_unit: Optional[str] = "g"


# In-state events


class SourceRef(BaseModel):
    """Generic predecessor reference. lot_kind is one of:
    'ingest' | 'agar' | 'lc' | 'grain' | 'harvest' | 'batch'.
    """
    lot_kind: Literal["ingest", "agar", "lc", "grain", "harvest", "batch"]
    lot_id: str
    amount: Optional[float] = None
    amount_unit: Optional[str] = None


class BreakAndShakeIn(EventBase):
    grain_lot_id: str


class ContaminationFlagIn(EventBase):
    lot_kind: str
    lot_id: str
    severity: Literal["suspect", "confirmed"] = "suspect"
    quarantine: bool = True
    suspected_contaminant: Optional[str] = None


class ContaminationLiftIn(EventBase):
    flag_id: str
    reason: Optional[str] = None


class WeightMeasurementIn(EventBase):
    lot_kind: str
    lot_id: str
    weight: float
    unit: str = "g"
    context: Optional[str] = None


class MoveLocationIn(EventBase):
    lot_kind: str
    lot_id: str
    new_location: str


class ConsumePartialIn(EventBase):
    lot_kind: Literal["agar", "lc", "grain", "harvest"]
    lot_id: str
    amount: float = Field(gt=0)
    amount_unit: Optional[str] = None
    reason: str = "waste"


class NoteAttachIn(EventBase):
    lot_kind: Optional[str] = None
    lot_id: Optional[str] = None
    target_event_id: Optional[str] = None
    note: str


class LifecycleIn(EventBase):
    lot_kind: str
    lot_id: str
    reason: Optional[str] = None
    recipient: Optional[str] = None  # for MarkGifted


# ---------------------------------------------------------------------------
# Recipe
# ---------------------------------------------------------------------------


class RecipeComponent(BaseModel):
    component_code: str
    proportion: float
    unit: str


class RecipeIn(BaseModel):
    code: str
    name: str
    components: list[RecipeComponent] = Field(default_factory=list)
    hydration_target: Optional[str] = None
    prep_method: Optional[str] = None
    notes: Optional[str] = None
    extra: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Lot counter
# ---------------------------------------------------------------------------


class CounterRequest(BaseModel):
    prefix: str
    code: Optional[str] = None
    date: str  # YYMMDD


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SettingIn(BaseModel):
    value: Any


# Resolve forward refs
PlateAgarIn.model_rebuild()
PlateLCIn.model_rebuild()
InoculateGrainIn.model_rebuild()
