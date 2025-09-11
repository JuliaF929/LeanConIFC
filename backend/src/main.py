from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import os
import ifcopenshell
from ifcopenshell.util import element as ifc_element

app = FastAPI()

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

    for element in model.by_type("IfcBuildingElement"):
        loc = _get_element_location(element)
        level_name, level_elevation = _get_element_level(element)

        x, y, z_rel = None, None, None
        real_world_z = None

        if loc:
            x, y, z_rel = loc["x"], loc["y"], loc["z"]
            real_world_z = level_elevation + z_rel

        data = {
            "x": x,
            "y": y,
            "z_relative_to_level": z_rel,
            "real_world_z": real_world_z,
            "level_name": level_name,
            "level_elevation": level_elevation,
            "type": element.is_a(),
            "unit": unit,
        }

        print(data)  # shows in console
        elements.append(data)

    return {"elements": elements}


# Run with:
# uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
