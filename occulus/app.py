import base64, os, secrets, json, subprocess
from flask import Flask, request, jsonify, abort, send_from_directory
from botocore.exceptions import BotoCoreError, ClientError
from .core import Catalog, fetch_range
from .modules import ModuleCatalog
from .occurrences import OccurrenceReader
from .cog import CogEvaluation


def wsl_network():
    if os.getenv("OCCULUS_WSL_ACCESS") != "1":
        return None, None
    routes = json.loads(
        subprocess.check_output(["ip", "-j", "route", "get", "1.1.1.1"])
    )
    route = routes[0]
    return route.get("prefsrc"), route.get("gateway")


def create_app(catalog=None):
    app = Flask(__name__, static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = 4096
    catalog = catalog or Catalog()
    occurrences = OccurrenceReader(catalog.s3)
    cog = CogEvaluation(catalog.s3)
    catalogs = {
        "phytobloom": catalog,
        "ste": ModuleCatalog("ste", catalog.s3),
        "siapresp": ModuleCatalog("siapresp", catalog.s3),
    }

    def selected_catalog():
        module = request.args.get("module", "phytobloom")
        if module not in catalogs:
            raise ValueError("Módulo inválido.")
        return catalogs[module]

    def selected_dataset():
        dataset = request.args.get("dataset", "original")
        if dataset not in ("original", "cog") or (dataset == "cog" and request.args.get("module") != "ste"):
            raise ValueError("Conjunto de avaliação inválido.")
        return dataset

    token = secrets.token_urlsafe(32)
    wsl_ip, gateway = wsl_network()
    allowed_hosts = {"127.0.0.1", "localhost", "[::1]"}
    allowed_clients = {"127.0.0.1", "::1"}
    if wsl_ip:
        allowed_hosts.add(wsl_ip)
        allowed_clients.add(wsl_ip)
    if gateway:
        allowed_clients.add(gateway)

    @app.before_request
    def local_only():
        if (
            request.host.rsplit(":", 1)[0] not in allowed_hosts
            or request.remote_addr not in allowed_clients
        ):
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
            "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.google.com https://*.googleapis.com https://*.gstatic.com; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com; frame-ancestors 'none'"
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

    @app.get("/api/config")
    def config():
        return {"googleMapsKey": os.getenv("GOOGLE_MAPS_API_KEY", ""), "hosted": False}

    @app.get("/api/range")
    def partial():
        key = request.args.get("key", "")
        selected = selected_catalog()
        item = selected.items.get(key)
        if not item:
            raise ValueError("Arquivo não encontrado no catálogo.")
        if selected_dataset() == "cog":
            row = cog.index().get(key)
            if not row or row["source_etag"] != item["etag"]:
                raise ValueError("Arquivo fora do lote de avaliação COG atual.")
            key = row["key"]
            item = {**item, "bytes": row["bytes"], "etag": row["etag"]}
            if request.args.get("etag") != item["etag"]:
                return jsonify(error="A cópia COG mudou. Atualize o catálogo."), 409
        start, end = int(request.args["start"]), int(request.args["end"])
        if start < 0 or end < start or end - start + 1 > 262144:
            raise ValueError("Intervalo inválido.")
        end = min(end, item["bytes"] - 1)
        if start > end:
            raise ValueError("Intervalo fora do arquivo.")
        data = fetch_range(selected.s3, selected.bucket, key, start, end, item["etag"])
        return app.response_class(data, mimetype="application/octet-stream")

    @app.get("/api/occurrences")
    def occurrence_table():
        result = occurrences.read(request.args.get("module", ""), request.args.get("key", ""))
        if result is None:
            return jsonify(error="Não há tabela de ocorrência identificada para esta espécie/grupo."), 404
        return jsonify(result)

    @app.get("/api/catalog")
    def listing():
        dataset = selected_dataset()
        result = selected_catalog().list(request.args.get("refresh") == "1")
        return jsonify(cog.catalog(result) if dataset == "cog" else result)

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

    port = int(os.getenv("OCCULUS_PORT", "8765"))
    wsl_ip, _ = wsl_network()
    listeners = f"127.0.0.1:{port}"
    if wsl_ip:
        listeners += f" {wsl_ip}:{port}"
    serve(create_app(), listen=listeners, threads=16)
