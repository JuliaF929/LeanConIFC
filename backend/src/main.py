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

# 🔧 Hardcoded path to IFC file
IFC_FILE_PATH = "C:/base_structure.ifc"

# Load model once at startup
if os.path.exists(IFC_FILE_PATH):
    model = ifcopenshell.open(IFC_FILE_PATH)
else:
    model = None


def _get_element_location(element):
    """
    Return local placement coordinates (relative to storey).
    """
    if hasattr(element, "ObjectPlacement") and element.ObjectPlacement:
        try:
            placement = element.ObjectPlacement.RelativePlacement
            x, y, z = placement.Location.Coordinates
            return {"x": float(x), "y": float(y), "z": float(z)}
        except Exception:
            return None
    return None


def _get_element_level(element):
    """
    Return storey name and elevation (flattened).
    """
    storey = ifc_element.get_container(element)
    if storey and storey.is_a("IfcBuildingStorey"):
        return (
            storey.Name,
            float(storey.Elevation) if storey.Elevation is not None else 0.0,
        )
    return (None, 0.0)


def _get_unit():
    """
    Return the length unit from the IFC header.
    """
    try:
        units = model.by_type("IfcUnitAssignment")[0].Units
        for u in units:
            if u.UnitType == "LENGTHUNIT":
                return f"{u.Prefix or ''}{u.Name}"  # e.g. "MilliMETRE" or "METRE"
    except Exception:
        return None
    return None


@app.get("/api/elements")
def get_elements():
    if model is None:
        raise HTTPException(status_code=404, detail=f"IFC file not found: {IFC_FILE_PATH}")

    unit = _get_unit()
    elements = []
    type_summary = defaultdict(int)

    for element in model.by_type("IfcBuildingElement"):
        loc = _get_element_location(element)
        level_name, level_elevation = _get_element_level(element)

        x, y, z_rel = None, None, None
        real_world_z = None

        if loc:
            x, y, z_rel = loc["x"], loc["y"], loc["z"]
            real_world_z = level_elevation + z_rel

        elem_type = element.is_a()
        type_summary[elem_type] += 1

        data = {
            "x": x,
            "y": y,
            "z_relative_to_level": z_rel,
            "real_world_z": real_world_z,
            "level_name": level_name,
            "level_elevation": level_elevation,
            "type": elem_type,
            "unit": unit,
        }

        print(data)  # shows in console
        elements.append(data)

    # Build grouped summary
    groups = []
    for elem_type, count in type_summary.items():
        groups.append({
            "type": elem_type,
            "unit": unit,
            "count": count,
        })

    return {
        "elements": elements,
        "summary": groups
    }


# Run with:
# uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
