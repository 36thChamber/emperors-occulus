import base64, os, secrets
from flask import Flask, request, jsonify, abort, send_from_directory
from botocore.exceptions import BotoCoreError, ClientError
from .core import Catalog


def create_app(catalog=None):
    app = Flask(__name__, static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = 4096
    catalog = catalog or Catalog()
    token = secrets.token_urlsafe(32)

    @app.before_request
    def local_only():
        if request.host.split(":")[0] not in ("127.0.0.1", "localhost", "[::1]"):
            abort(403)
        if (
            request.path.startswith("/api/")
            and request.headers.get("X-Occulus-Token") != token
        ):
            abort(403)

    @app.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'"
        )
        return response

    @app.get("/")
    def index():
        text = (
            __import__("pathlib").Path(app.static_folder) / "index.html"
        ).read_text()
        return text.replace("__TOKEN__", token)

    @app.get("/health")
    def health():
        return {"app": "emperors-occulus", "status": "ok"}

    @app.get("/api/catalog")
    def listing():
        return jsonify(catalog.list(request.args.get("refresh") == "1"))

    @app.post("/api/preview")
    def preview():
        body = request.get_json()
        crop = tuple(float(v) for v in body.get("crop", [0, 0, 1, 1]))
        png, metadata = catalog.preview(
            body["key"], int(body.get("resolution", 128)), crop
        )
        return jsonify(image=base64.b64encode(png).decode(), metadata=metadata)

    @app.errorhandler(ValueError)
    @app.errorhandler(KeyError)
    @app.errorhandler(TypeError)
    def invalid(e):
        return jsonify(error=str(e)), 400

    @app.errorhandler(BotoCoreError)
    @app.errorhandler(ClientError)
    def aws_error(e):
        app.logger.warning("AWS read failed: %s", type(e).__name__)
        code = (
            e.response["Error"]["Code"]
            if isinstance(e, ClientError)
            else type(e).__name__
        )
        return jsonify(
            error=f"Não foi possível ler a AWS ({code}). Confira as credenciais locais e atualize o catálogo."
        ), 502

    @app.errorhandler(Exception)
    def unexpected(e):
        from werkzeug.exceptions import HTTPException

        if isinstance(e, HTTPException):
            return e
        app.logger.exception("Preview failure")
        return jsonify(
            error="Não foi possível abrir esta prévia. Consulte o log local."
        ), 500

    return app


if __name__ == "__main__":
    from waitress import serve

    serve(
        create_app(),
        host="127.0.0.1",
        port=int(os.getenv("OCCULUS_PORT", "8765")),
        threads=4,
    )
