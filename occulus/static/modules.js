/* Shared module schema: fixed buckets and allowlisted published products only. */
(function (root) {
  const scenario =
    "(?:anual_\\d{4}_\\d{4}|mensal_\\d{2}_[a-z]+|futuro_\\d{4}_ssp(?:245|585))";
  const phyto = /^\d+_\d{4}_\d{2}_\d{2}_(?:NDCI|NDVI2?|RGB(?:_MASK)?)\.tif$/;
  const classic = new RegExp(
    "^predictions/(caraya|guariba|nigritus|aranha)/([A-Za-z_]+)_(nacional_1km|rs_250m|poligono_30m)_(" +
      scenario +
      ")_(adequabilidade|incerteza)\\.tif$",
  );
  const batch = new RegExp(
    "^predicoes_cenarios/([a-z0-9-]+)/([A-Za-z0-9_]+)/(" +
      scenario +
      ")/([A-Za-z0-9_]+)_(" +
      scenario +
      ")_(adequabilidade(?:_R)?|incerteza|extrapolacao)\\.tif$",
  );
  const daily =
    /^predictions\/daily\/(\d{4}-\d{2}-\d{2})\/([a-z0-9_]+)\/([a-z0-9_]+)_rf_(\d{4}-\d{2}-\d{2})_(mean|sd)\.tif$/;
  const definitions = {
    phytobloom: {
      label: "Phytobloom",
      bucket: "copel-siapesq",
      prefixes: [""],
    },
    ste: {
      label: "SIAPESQ STE",
      bucket: "ste-siapesq",
      prefixes: ["predictions/", "predicoes_cenarios/"],
    },
    siapresp: {
      label: "SIAPRESP",
      bucket: "tifs-siapesq",
      prefixes: ["predictions/daily/"],
    },
  };
  function parse(module, key) {
    if (module === "phytobloom" && phyto.test(key)) {
      const m = key.match(/^(\d+)_(\d{4})_(\d{2})_(\d{2})_(.+)\.tif$/);
      return {
        module,
        key,
        area: m[1],
        region: "",
        date: `${m[2]}-${m[3]}-${m[4]}`,
        product: m[5],
      };
    }
    if (module === "ste") {
      const m = key.match(classic);
      if (m)
        return {
          module,
          key,
          area: m[2],
          slug: m[1],
          region: m[3],
          date: m[4],
          product: m[5],
        };
      const b = key.match(batch);
      if (b && b[2] === b[4] && b[3] === b[5])
        return {
          module,
          key,
          area: b[2],
          region: "lote:" + b[1],
          date: b[3],
          product: b[6],
        };
    }
    if (module === "siapresp") {
      const m = key.match(daily);
      if (m && m[1] === m[4] && m[2] === m[3])
        return {
          module,
          key,
          area: m[2],
          region: "",
          date: m[1],
          product: m[5],
        };
    }
    return null;
  }
  const months = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const scenarioLabel = (s) =>
    s.startsWith("anual_")
      ? "Anual · " + s.slice(6).replace("_", "–")
      : s.startsWith("mensal_")
        ? "Mensal · " +
          (months[Number(s.split("_")[1]) - 1] ||
            s.split("_").slice(2).join(" "))
        : s.startsWith("futuro_")
          ? s.replace(
              /^futuro_(\d+)_ssp(\d)(\d)(\d)$/,
              "Futuro · $1 · SSP$2-$3.$4",
            )
          : s.split("-").reverse().join("/");
  const areaLabel = (a, module) =>
    module === "phytobloom"
      ? "Área " + a
      : a === "Primatas_grupo"
        ? "Primatas · aranha"
        : a.replaceAll("_", " ");
  const regionLabel = (r) => {
    const named = {
      nacional_1km: "Brasil · 1 km",
      rs_250m: "RS · 250 m",
      poligono_30m: "Polígono · 30 m",
      atlantic: "Atlântico Sul",
      integral: "Extensão integral",
    };
    if (named[r]) return named[r];
    if (r.startsWith("lote:")) {
      const stamp = r.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      const place = r.includes("exclusivas-es-ocean")
        ? "ES · oceânico"
        : r.includes("exclusivas-rs")
          ? "RS · exclusivas"
          : "RS + ES";
      const variants = r.includes("17cenarios")
        ? " · 17 cenários"
        : r.includes("exclusivas-es-ocean")
          ? " · anual"
          : "";
      return (
        place +
        variants +
        (stamp ? " · " + stamp.split("-").reverse().join("/") : "")
      );
    }
    return r;
  };
  const productLabel = (p) =>
    ({
      NDCI: "NDCI · clorofila",
      NDVI: "NDVI · vegetação",
      NDVI2: "NDVI2 · macrófitas",
      RGB: "RGB · cor natural",
      RGB_MASK: "RGB · com máscara",
      adequabilidade: "Adequabilidade",
      adequabilidade_R: "Adequabilidade · original R",
      incerteza: "Incerteza · desvio-padrão",
      extrapolacao: "Extrapolação",
      mean: "Predição · média",
      sd: "Incerteza · desvio-padrão",
    })[p] || p;
  root.OcculusModules = {
    definitions,
    parse,
    scenarioLabel,
    areaLabel,
    regionLabel,
    productLabel,
  };
})(globalThis);
