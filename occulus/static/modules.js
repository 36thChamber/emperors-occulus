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
      label: "SIAPESQ",
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
  // Display names only: keep catalog IDs and S3 keys unchanged.
  // camarao has no scientific identification in the historical registry.
  const marineNames = {
    thunnus_obesus: "Albacora-bandolim (Thunnus obesus)",
    thunnus_albacares: "Albacora-laje (Thunnus albacares)",
    thunnus_alalunga: "Albacora-branca (Thunnus alalunga)",
    katsuwonus_pelamis: "Bonito-listrado (Katsuwonus pelamis)",
    tursiops_truncatus: "Golfinho-nariz-de-garrafa (Tursiops truncatus)",
    xiphias_gladius: "Espadarte (Xiphias gladius)",
    caretta_caretta: "Tartaruga-cabeçuda (Caretta caretta)",
    megaptera_novaeangliae: "Baleia-jubarte (Megaptera novaeangliae)",
    caranx_all: "Xaréus (Caranx spp.)",
    mugil_liza: "Tainha (Mugil liza)",
    merluccius_hubbsi: "Merluza-argentina (Merluccius hubbsi)",
    micropogonias_furnieri: "Corvina (Micropogonias furnieri)",
    pomatomus_saltatrix: "Anchova (Pomatomus saltatrix)",
    sardinella_brasiliensis: "Sardinha-verdadeira (Sardinella brasiliensis)",
    urophycis_brasiliensis: "Abrótea (Urophycis brasiliensis)",
    cynoscion_all: "Pescadas (Cynoscion spp.)",
    camarao: "Camarões (nome científico não informado)",
    engraulis_anchoita: "Anchoíta (Engraulis anchoita)",
    merluccius_merluccius: "Merluza-europeia (Merluccius merluccius)",
  };
  const siapesqNames = {
    "acromyrmex_crassispinus": "Quenquém-de-cisco (Acromyrmex crassispinus)",
    "acromyrmex_subterraneus": "Quenquém-mineira (Acromyrmex subterraneus)",
    "alouatta_caraya": "Bugio-preto (Alouatta caraya)",
    "alouatta_guariba": "Bugio-ruivo (Alouatta guariba)",
    "butia_eriospatha": "Butiá-da-serra (Butia eriospatha)",
    "caracara_plancus": "Carcará (Caracara plancus)",
    "cariama_cristata": "Seriema (Cariama cristata)",
    "cedrela_fissilis": "Cedro-rosa (Cedrela fissilis)",
    "cerdocyon_thous": "Cachorro-do-mato (Cerdocyon thous)",
    "chelonia_mydas": "Tartaruga-verde (Chelonia mydas)",
    "ciconia_maguari": "Maguari (Ciconia maguari)",
    "columbina_talpacoti": "Rolinha-roxa (Columbina talpacoti)",
    "dasypus_novemcinctus": "Tatu-galinha (Dasypus novemcinctus)",
    "desmodus_rotundus": "Morcego-vampiro-comum (Desmodus rotundus)",
    "didelphis_albiventris": "Gambá-de-orelha-branca (Didelphis albiventris)",
    "eira_barbara": "Irara (Eira barbara)",
    "eugenia_uniflora": "Pitangueira (Eugenia uniflora)",
    "guira_guira": "Anu-branco (Guira guira)",
    "hydrochoerus_hydrochaeris": "Capivara (Hydrochoerus hydrochaeris)",
    "nasua_nasua": "Quati (Nasua nasua)",
    "phalacrocorax_brasilianus": "Biguá (Phalacrocorax brasilianus)",
    "pitangus_sulphuratus": "Bem-te-vi (Pitangus sulphuratus)",
    "puma_concolor": "Onça-parda (Puma concolor)",
    "ramphastos_dicolorus": "Tucano-de-bico-verde (Ramphastos dicolorus)",
    "rupornis_magnirostris": "Gavião-carijó (Rupornis magnirostris)",
    "sapajus_nigritus": "Macaco-prego-preto (Sapajus nigritus)",
    "schizolobium_parahyba": "Guapuruvu (Schizolobium parahyba)",
    "troglodytes_musculus": "Corruíra (Troglodytes musculus)",
    "turdus_rufiventris": "Sabiá-laranjeira (Turdus rufiventris)",
    "vanellus_chilensis": "Quero-quero (Vanellus chilensis)",
    "vireo_chivi": "Juruviara (Vireo chivi)",
    "primatas_grupo": "Aranha · grupo de primatas (Primates)"
};
  const areaLabel = (a, module) =>
    module === "phytobloom"
      ? "Área " + a
      : module === "siapresp" && marineNames[a.toLowerCase()]
        ? marineNames[a.toLowerCase()]
      : module === "ste" && (siapesqNames[a.toLowerCase()] || marineNames[a.toLowerCase()])
        ? siapesqNames[a.toLowerCase()] || marineNames[a.toLowerCase()]
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
