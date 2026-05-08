import os
from pathlib import Path

import pandas as pd
from pydantic import BaseModel
from fastapi import APIRouter

router = APIRouter(tags=["professors"])

DATA_PATH = Path(__file__).resolve().parent.parent / "data.xlsx"


def _load_data() -> pd.DataFrame:
    return pd.read_excel(DATA_PATH, header=1)


class ProfessorQuery(BaseModel):
    message: str


@router.post("/professors")
def search_professors(query: ProfessorQuery):
    """Keyword search over professor office hours Excel data."""
    question = query.message.lower()
    df = _load_data()

    results = []
    for _, row in df.iterrows():
        try:
            name = str(row.get("Name", ""))
            days = str(row.get("Day(s)", ""))
            time = str(row.get("Time (s)", ""))
            walk = str(row.iloc[3]) if len(row) > 3 else ""

            text = f"{name} is available on {days} at {time}. {walk}"

            if any(word in text.lower() for word in question.split()):
                results.append(text)
        except Exception:
            continue

    if not results:
        return {"response": "No matching professor found.", "results": []}

    return {"response": "\n".join(results[:5]), "results": results[:5]}
