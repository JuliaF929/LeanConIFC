from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import os
import ifcopenshell
from ifcopenshell.util import element as ifc_element
from collections import defaultdict
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow React dev server origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Hardcoded path to IFC file
IFC_FILE_PATH = "C:/base_structure.ifc"

# Load model once at startup
if os.path.exists(IFC_FILE_PATH):
    model = ifcopenshell.open(IFC_FILE_PATH)
else:
    model = None


def _get_element_location(element):
    if hasattr(element, "ObjectPlacement") and element.ObjectPlacement:
        try:
            placement = element.ObjectPlacement.RelativePlacement
            x, y, z = placement.Location.Coordinates
            return {"x": float(x), "y": float(y), "z": float(z)}
        except Exception:
            return None
    return None


def _get_element_level(element):
    storey = ifc_element.get_container(element)
    if storey and storey.is_a("IfcBuildingStorey"):
        return (
            storey.Name,
            float(storey.Elevation) if storey.Elevation is not None else 0.0,
        )
    return (None, 0.0)


def _get_unit():
    try:
        units = model.by_type("IfcUnitAssignment")[0].Units
        for u in units:
            if getattr(u, "UnitType", None) == "LENGTHUNIT":
                return f"{getattr(u, 'Prefix', None) or ''}{getattr(u, 'Name', '')}"
    except Exception:
        return None
    return None


# NEW: derive dimensionality from IFC (quantities first, then geometry)
def _get_element_dimension(element) -> int:
    # First check for quantity sets
    for definition in getattr(element, "IsDefinedBy", []) or []:
        try:
            rel_def = definition.RelatingDefinition
        except Exception:
            continue
        if hasattr(rel_def, "is_a") and rel_def.is_a("IfcElementQuantity") and getattr(rel_def, "Quantities", None):
            for q in rel_def.Quantities:
                try:
                    if q.is_a("IfcQuantityVolume"):   # m^3
                        return 3
                    if q.is_a("IfcQuantityArea"):     # m^2
                        return 2
                    if q.is_a("IfcQuantityLength"):   # m^1
                        return 1
                except Exception:
                    continue

    # Otherwise check geometry representations
    try:
        reps = element.Representation.Representations if element.Representation else []
    except Exception:
        reps = []
    for rep in reps:
        rtype = getattr(rep, "RepresentationType", None)
        if rtype in ["Curve2D", "GeometricCurveSet", "Annotation2D"]:
            return 2
        if rtype in ["SurfaceModel", "Brep", "AdvancedBrep", "SweptSolid", "CSG", "MappedRepresentation", "Tessellation"]:
            return 3

    # Fallback
    return 1


@app.get("/api/elements")
def get_elements():
    if model is None:
        raise HTTPException(status_code=404, detail=f"IFC file not found: {IFC_FILE_PATH}")

    unit = _get_unit()
    elements = []
    type_summary = defaultdict(int)
    type_dim = {}  # cache dimension per IFC type (first instance wins)

    for element in model.by_type("IfcBuildingElement") or []:
        loc = _get_element_location(element)
        level_name, level_elevation = _get_element_level(element)

        x, y, z_rel = None, None, None
        real_world_z = None

        if loc:
            x, y, z_rel = loc["x"], loc["y"], loc["z"]
            real_world_z = (level_elevation or 0.0) + (z_rel or 0.0)

        elem_type = element.is_a()
        type_summary[elem_type] += 1

        # get dimension (cache per type to avoid recomputing)
        dim = type_dim.get(elem_type)
        if dim is None:
            dim = _get_element_dimension(element)
            type_dim[elem_type] = dim

        unit_with_dim = f"{(unit or 'METER').upper()}^{dim}" if unit else None

        data = {
            "x": x,
            "y": y,
            "z_relative_to_level": z_rel,
            "real_world_z": real_world_z,
            "level_name": level_name,
            "level_elevation": level_elevation,
            "type": elem_type,
            "unit": unit_with_dim,
        }

        print(data)  # shows in console
        elements.append(data)

    # Count distinct levels
    levels = model.by_type("IfcBuildingStorey") or []
    levels_sorted = sorted(
        [(lv.Name, float(lv.Elevation) if lv.Elevation else 0.0) for lv in levels],
        key=lambda x: x[1],
        reverse=True
    )
    level_names = [name for name, _ in levels_sorted]

    # Build grouped summary
    groups = []
    for elem_type, count in type_summary.items():
        dim = type_dim.get(elem_type, 1)
        unit_with_dim = f"{(unit or 'METER').upper()}^{dim}" if unit else None
        groups.append({
            "type": elem_type,
            "unit": unit_with_dim,
            "count": count,
        })

    return {
        "elements": elements,
        "summary": groups,
        "levels": level_names
    }


# Run with:
# uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
