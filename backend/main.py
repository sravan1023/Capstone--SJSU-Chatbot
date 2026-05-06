from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

load_dotenv()

from routers import chat, professors, jobs

app = FastAPI(title="SJSU Copilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(professors.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")


@app.get("/")
def health():
    return {"status": "ok", "service": "sjsu-copilot-backend"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)