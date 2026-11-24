// ============================================================================
// MUMAX0 — Motor de Estado, Visualização 2D, Diagnóstico Físico e Gerador .mx3
// ============================================================================

(function () {
  "use strict";

  const MU0 = 4 * Math.PI * 1e-7; // H/m

  const appState = {
    lang: "pt",
    mode: "basic",
    activeStep: 1,
    activeHelp: "welcome",
    manualEdit: false,
    lastGeneratedCode: ""
  };

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const num = (id, fallback = 0) => {
    const el = $(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
  };
  const intVal = (id, fallback = 1) => Math.max(0, Math.round(num(id, fallback)));
  const strVal = (id, fallback = "") => ($(id) ? $(id).value.trim() : fallback);
  const boolVal = (id) => ($(id) ? Boolean($(id).checked) : false);

  function fmtNum(x, digits = 4) {
    if (!Number.isFinite(x)) return "0";
    if (Math.abs(x) === 0) return "0";
    return Number(x.toPrecision(digits)).toString();
  }

  function fmtSci(val, expStr) {
    if (!Number.isFinite(val) || Math.abs(val) === 0) return "0";
    const clean = Number(val.toPrecision(6)).toString();
    return expStr ? `${clean}${expStr}` : clean;
  }

  function largestPrimeFactor(n) {
    let x = Math.max(1, Math.floor(n));
    let maxP = 1;
    for (let p = 2; p * p <= x; p++) {
      while (x % p === 0) {
        maxP = p;
        x = Math.floor(x / p);
      }
    }
    if (x > 1) maxP = x;
    return maxP;
  }

  function sanitizeFilename(raw) {
    const clean = (raw || "simulacao.mx3").replace(/[^a-zA-Z0-9._-]/g, "_");
    return clean.toLowerCase().endsWith(".mx3") ? clean : `${clean}.mx3`;
  }

  // Deterministic PRNG (Mulberry32) so randomMag preview stays stable
  function mulberry32(seed) {
    let a = (seed >>> 0) || 1234567;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Read Full Form State ----------
  function readFormState() {
    const nx = Math.max(1, intVal("nx", 128));
    const ny = Math.max(1, intVal("ny", 64));
    const nz = Math.max(1, intVal("nz", 1));
    const cellMode = strVal("cell-mode", "cell");

    let cxNm, cyNm, czNm, lxNm, lyNm, lzNm;
    if (cellMode === "total") {
      lxNm = Math.max(0.1, num("lx", 500));
      lyNm = Math.max(0.1, num("ly", 125));
      lzNm = Math.max(0.1, num("lz", 3));
      cxNm = lxNm / nx;
      cyNm = lyNm / ny;
      czNm = lzNm / nz;
    } else {
      cxNm = Math.max(0.05, num("cx", 2));
      cyNm = Math.max(0.05, num("cy", 2));
      czNm = Math.max(0.05, num("cz", 5));
      lxNm = nx * cxNm;
      lyNm = ny * cyNm;
      lzNm = nz * czNm;
    }

    const isAdv = appState.mode === "advanced";

    return {
      mode: appState.mode,
      nx, ny, nz,
      cellMode,
      cxNm, cyNm, czNm,
      lxNm, lyNm, lzNm,
      pbcx: isAdv ? intVal("pbcx", 0) : 0,
      pbcy: isAdv ? intVal("pbcy", 0) : 0,
      pbcz: isAdv ? intVal("pbcz", 0) : 0,

      geomType: strVal("geom-type", "box"),
      geomDiam: Math.max(1, num("geom-diam", 240)),
      geomEa: Math.max(1, num("geom-ea", 240)),
      geomEb: Math.max(1, num("geom-eb", 120)),
      geomRout: Math.max(2, num("geom-rout", 240)),
      geomRin: Math.max(0.5, num("geom-rin", 100)),
      geomCx: Math.max(1, num("geom-cx", 200)),
      geomCy: Math.max(1, num("geom-cy", 100)),
      geomCz: Math.max(0.5, num("geom-cz", 5)),
      geomImg: strVal("geom-img", "mascara.png") || "mascara.png",
      edgeSmooth: isAdv ? intVal("edge-smooth", 0) : 0,

      msatKAm: Math.max(0, num("msat", 800)),
      aexPJm: Math.max(0, num("aex", 13)),
      alpha: Math.max(1e-6, num("alpha", 0.02)),
      enableDemag: boolVal("enable-demag"),
      ku1KJm3: num("ku1", 0),
      anisUx: num("anisu-x", 0),
      anisUy: num("anisu-y", 0),
      anisUz: num("anisu-z", 1),
      kc1KJm3: isAdv ? num("kc1", 0) : 0,
      dmiType: isAdv ? strVal("dmi-type", "none") : "none",
      dmiMJm2: isAdv ? num("dmi-val", 3.0) : 0,
      tempK: isAdv ? Math.max(0, num("temp-k", 0)) : 0,
      thermSeed: isAdv ? intVal("therm-seed", 0) : 0,

      m0Type: strVal("m0-type", "uniform"),
      m0Ux: num("m0-ux", 1),
      m0Uy: num("m0-uy", 0.1),
      m0Uz: num("m0-uz", 0),
      m0Seed: intVal("m0-seed", 0),
      m0Vcirc: parseInt(strVal("m0-vcirc", "1"), 10) || 1,
      m0Vpol: parseInt(strVal("m0-vpol", "1"), 10) || 1,
      td1x: num("td-1x", 1), td1y: num("td-1y", 0), td1z: num("td-1z", 0),
      tdwx: num("td-wx", 0), tdwy: num("td-wy", 1), tdwz: num("td-wz", 0),
      td2x: num("td-2x", -1), td2y: num("td-2y", 0), td2z: num("td-2z", 0),
      m0Skq: parseInt(strVal("m0-skq", "1"), 10) || 1,
      m0Skp: parseInt(strVal("m0-skp", "1"), 10) || 1,
      m0OvfFile: strVal("m0-ovf-file", "estado_inicial.ovf") || "estado_inicial.ovf",

      saveInitOvf: boolVal("save-init-ovf"),
      snapInitPng: boolVal("snap-init-png"),
      tableInitSave: boolVal("table-init-save"),

      eqOp: strVal("eq-op", "relax"),
      eqBx: num("eq-bx", 0),
      eqBy: num("eq-by", 0),
      eqBz: num("eq-bz", 0),
      saveEqOvf: boolVal("save-eq-ovf"),
      snapEqPng: boolVal("snap-eq-png"),
      tableEqSave: boolVal("table-eq-save"),

      dynMode: strVal("dyn-mode", "none"),
      dynBx: num("dyn-bx", -24.6),
      dynBy: num("dyn-by", 4.3),
      dynBz: num("dyn-bz", 0),
      dynRunNs: Math.max(1e-4, num("dyn-run-ns", 1)),

      plsBx: num("pls-bx", 15),
      plsBy: num("pls-by", 0),
      plsBz: num("pls-bz", 0),
      plsTon: Math.max(1e-4, num("pls-ton", 2)),
      plsToff: Math.max(0, num("pls-toff", 3)),

      hystBmax: Math.max(0.1, num("hyst-bmax", 100)),
      hystBstep: Math.max(0.1, num("hyst-bstep", 5)),
      hystAxis: strVal("hyst-axis", "x"),
      hystTilt: Math.max(0, Math.min(45, num("hyst-tilt", 1))),
      hystCycle: strVal("hyst-cycle", "full"),
      hystSolver: strVal("hyst-solver", "minimize"),

      sincB0: num("sinc-b0", 5),
      sincAxis: strVal("sinc-axis", "z"),
      sincFc: Math.max(0.1, num("sinc-fc", 25)),
      sincT0: Math.max(0.01, num("sinc-t0", 0.5)),
      sincTot: Math.max(0.1, num("sinc-tot", 5)),

      sttJx: num("stt-jx", 5),
      sttJy: num("stt-jy", 0),
      sttPol: Math.max(0, Math.min(1, num("stt-pol", 0.56))),
      sttXi: Math.max(0, num("stt-xi", 0.1)),
      sttNs: Math.max(1e-4, num("stt-ns", 5)),

      autosavePs: Math.max(0, num("autosave-ps", 200)),
      tableautoPs: Math.max(0, num("tableauto-ps", 10)),

      taddEtotal: boolVal("tadd-etotal"),
      taddBext: boolVal("tadd-bext"),
      taddEexch: boolVal("tadd-eexch"),
      taddEdemag: boolVal("tadd-edemag"),
      taddEanis: boolVal("tadd-eanis"),
      taddEzeeman: boolVal("tadd-ezeeman"),
      taddTopo: isAdv ? boolVal("tadd-topo") : false,
      taddDt: isAdv ? boolVal("tadd-dt") : false,

      outFormat: strVal("out-format", "default"),
      includeComments: boolVal("include-comments"),
      solverId: isAdv ? strVal("solver-id", "default") : "default",
      fixDtFs: isAdv ? Math.max(0, num("fix-dt", 0)) : 0,
      maxErr: isAdv ? Math.max(0, num("max-err", 0)) : 0,
      extraCode: isAdv ? ($("extra-code") ? $("extra-code").value : "") : "",

      filename: sanitizeFilename(strVal("script-filename", "simulacao.mx3"))
    };
  }

  // ---------- Generate Valid MuMax3 .mx3 Script ----------
  function generateMx3(s) {
    const lines = [];
    const c = (ptText, enText) => {
      if (!s.includeComments) return;
      lines.push(`// ${appState.lang === "en" ? enText : ptText}`);
    };

    if (s.includeComments) {
      lines.push(`// =================================================================`);
      lines.push(`// ${s.filename} — ${appState.lang === "en" ? "Generated by MUMAX0" : "Gerado pelo MUMAX0"}`);
      lines.push(`// ${appState.lang === "en" ? "Total box" : "Caixa total"}: ${fmtNum(s.lxNm, 4)} x ${fmtNum(s.lyNm, 4)} x ${fmtNum(s.lzNm, 4)} nm^3`);
      lines.push(`// =================================================================`);
      lines.push("");
    }

    // 1. MALHA E GEOMETRIA
    c("1. Malha e Geometria", "1. Mesh & Geometry");
    lines.push(`SetGridSize(${s.nx}, ${s.ny}, ${s.nz})`);
    if (s.cellMode === "total") {
      lines.push(
        `SetCellSize(${fmtSci(s.lxNm, "e-9")}/${s.nx}, ${fmtSci(s.lyNm, "e-9")}/${s.ny}, ${fmtSci(s.lzNm, "e-9")}/${s.nz})`
      );
    } else {
      lines.push(
        `SetCellSize(${fmtSci(s.cxNm, "e-9")}, ${fmtSci(s.cyNm, "e-9")}, ${fmtSci(s.czNm, "e-9")})`
      );
    }

    if (s.pbcx > 0 || s.pbcy > 0 || s.pbcz > 0) {
      lines.push(`SetPBC(${s.pbcx}, ${s.pbcy}, ${s.pbcz})`);
    }

    if (s.edgeSmooth > 0 && s.geomType !== "box") {
      lines.push(`EdgeSmooth = ${s.edgeSmooth}`);
    }

    if (s.geomType === "circle") {
      lines.push(`SetGeom(circle(${fmtSci(s.geomDiam, "e-9")}))`);
    } else if (s.geomType === "ellipse") {
      lines.push(`SetGeom(ellipse(${fmtSci(s.geomEa, "e-9")}, ${fmtSci(s.geomEb, "e-9")}))`);
    } else if (s.geomType === "ring") {
      lines.push(
        `SetGeom(circle(${fmtSci(s.geomRout, "e-9")}).sub(circle(${fmtSci(s.geomRin, "e-9")})))`
      );
    } else if (s.geomType === "cuboid") {
      lines.push(
        `SetGeom(cuboid(${fmtSci(s.geomCx, "e-9")}, ${fmtSci(s.geomCy, "e-9")}, ${fmtSci(s.geomCz, "e-9")}))`
      );
    } else if (s.geomType === "image") {
      lines.push(`SetGeom(imageShape("${s.geomImg.replace(/"/g, "")}"))`);
    }

    lines.push("");

    // 2. MATERIAL E ENERGIAS
    c("2. Parâmetros Magnéticos do Material (SI)", "2. Magnetic Material Parameters (SI)");
    lines.push(`Msat  = ${fmtSci(s.msatKAm, "e3")}`);
    lines.push(`Aex   = ${fmtSci(s.aexPJm, "e-12")}`);
    lines.push(`alpha = ${fmtNum(s.alpha, 5)}`);

    if (!s.enableDemag) {
      c("Campo desmagnetizante desligado", "Demagnetizing field disabled");
      lines.push(`EnableDemag = false`);
    }

    if (Math.abs(s.ku1KJm3) > 0) {
      lines.push(`Ku1   = ${fmtSci(s.ku1KJm3, "e3")}`);
      lines.push(`anisU = vector(${fmtNum(s.anisUx, 4)}, ${fmtNum(s.anisUy, 4)}, ${fmtNum(s.anisUz, 4)})`);
    }

    if (Math.abs(s.kc1KJm3) > 0) {
      lines.push(`Kc1   = ${fmtSci(s.kc1KJm3, "e3")}`);
    }

    if (s.dmiType !== "none" && Math.abs(s.dmiMJm2) > 0) {
      lines.push(`${s.dmiType}  = ${fmtSci(s.dmiMJm2, "e-3")}`);
    }

    if (s.tempK > 0) {
      lines.push(`Temp  = ${fmtNum(s.tempK, 5)}`);
      if (s.thermSeed > 0) {
        lines.push(`ThermSeed(${s.thermSeed})`);
      }
    }

    lines.push("");

    // SOLVER & FORMATO (se configurados)
    const hasSolverOpts =
      s.solverId !== "default" || s.fixDtFs > 0 || s.maxErr > 0 || s.outFormat !== "default";
    if (hasSolverOpts) {
      c("Configurações de Solver e Formato de Saída", "Solver & Output Format Settings");
      if (s.solverId !== "default") lines.push(`SetSolver(${s.solverId})`);
      if (s.fixDtFs > 0) lines.push(`FixDt = ${fmtSci(s.fixDtFs, "e-15")}`);
      if (s.maxErr > 0) lines.push(`MaxErr = ${s.maxErr.toExponential()}`);
      if (s.outFormat !== "default") lines.push(`OutputFormat = ${s.outFormat}`);
      lines.push("");
    }

    // COLUNAS EXTRAS DA TABELA
    const tableCols = [];
    if (s.taddEtotal) tableCols.push("E_total");
    if (s.taddBext) tableCols.push("B_ext");
    if (s.taddEexch) tableCols.push("E_exch");
    if (s.taddEdemag) tableCols.push("E_demag");
    if (s.taddEanis) tableCols.push("E_anis");
    if (s.taddEzeeman) tableCols.push("E_Zeeman");
    if (s.taddTopo) tableCols.push("ext_topologicalcharge");
    if (s.taddDt) tableCols.push("dt");

    if (tableCols.length > 0) {
      c("Colunas adicionais registradas em table.txt", "Additional columns recorded in table.txt");
      tableCols.forEach((col) => lines.push(`TableAdd(${col})`));
      lines.push("");
    }

    // 3. ESTADO INICIAL
    c("3. Magnetização Inicial (ponto de partida)", "3. Initial Magnetization (starting state)");
    if (s.m0Type === "uniform") {
      lines.push(`m = uniform(${fmtNum(s.m0Ux, 4)}, ${fmtNum(s.m0Uy, 4)}, ${fmtNum(s.m0Uz, 4)})`);
    } else if (s.m0Type === "random") {
      if (s.m0Seed > 0) {
        lines.push(`m = randomMagSeed(${s.m0Seed})`);
      } else {
        lines.push(`m = randomMag()`);
      }
    } else if (s.m0Type === "vortex") {
      lines.push(`m = vortex(${s.m0Vcirc}, ${s.m0Vpol})`);
    } else if (s.m0Type === "twodomain") {
      lines.push(
        `m = twoDomain(${fmtNum(s.td1x)}, ${fmtNum(s.td1y)}, ${fmtNum(s.td1z)}, ${fmtNum(s.tdwx)}, ${fmtNum(s.tdwy)}, ${fmtNum(s.tdwz)}, ${fmtNum(s.td2x)}, ${fmtNum(s.td2y)}, ${fmtNum(s.td2z)})`
      );
    } else if (s.m0Type === "neel_sk") {
      lines.push(`m = neelSkyrmion(${s.m0Skq}, ${s.m0Skp})`);
    } else if (s.m0Type === "bloch_sk") {
      lines.push(`m = blochSkyrmion(${s.m0Skq}, ${s.m0Skp})`);
    } else if (s.m0Type === "loadfile") {
      lines.push(`m.LoadFile("${s.m0OvfFile.replace(/"/g, "")}")`);
    }

    if (s.tableInitSave) lines.push(`TableSave()`);
    if (s.saveInitOvf) lines.push(`SaveAs(m, "inicial")`);
    if (s.snapInitPng) lines.push(`SnapshotAs(m, "inicial.png")`);
    lines.push("");

    // 4. ETAPA 1 — EQUILÍBRIO ESTÁTICO
    if (s.eqOp !== "none") {
      c("4. Etapa 1 — Busca do Estado de Equilíbrio", "4. Stage 1 — Static Equilibrium Search");
      if (Math.abs(s.eqBx) > 0 || Math.abs(s.eqBy) > 0 || Math.abs(s.eqBz) > 0) {
        lines.push(
          `B_ext = vector(${fmtSci(s.eqBx, "e-3")}, ${fmtSci(s.eqBy, "e-3")}, ${fmtSci(s.eqBz, "e-3")})`
        );
      }
      if (s.eqOp === "relax" || s.eqOp === "both") lines.push(`relax()`);
      if (s.eqOp === "minimize" || s.eqOp === "both") lines.push(`minimize()`);
      if (s.tableEqSave) lines.push(`TableSave()`);
      if (s.saveEqOvf) lines.push(`SaveAs(m, "equilibrio")`);
      if (s.snapEqPng) lines.push(`SnapshotAs(m, "equilibrio.png")`);
      lines.push("");
    }

    // 5. ETAPA 2 — EXCITAÇÃO / DINÂMICA
    if (s.dynMode !== "none") {
      c("5. Etapa 2 — Excitação e Evolução", "5. Stage 2 — Excitation & Evolution");

      const usesAutoSave = ["field_run", "pulse_run", "sinc_fmr", "stt_zl"].includes(s.dynMode);
      if (usesAutoSave) {
        if (s.autosavePs > 0) lines.push(`Autosave(m, ${fmtSci(s.autosavePs, "e-12")})`);
        if (s.tableautoPs > 0) lines.push(`TableAutoSave(${fmtSci(s.tableautoPs, "e-12")})`);
      }

      if (s.dynMode === "field_run") {
        lines.push(
          `B_ext = vector(${fmtSci(s.dynBx, "e-3")}, ${fmtSci(s.dynBy, "e-3")}, ${fmtSci(s.dynBz, "e-3")})`
        );
        lines.push(`run(${fmtSci(s.dynRunNs, "e-9")})`);
      } else if (s.dynMode === "pulse_run") {
        c("Pulso ligado", "Pulse ON");
        lines.push(
          `B_ext = vector(${fmtSci(s.plsBx, "e-3")}, ${fmtSci(s.plsBy, "e-3")}, ${fmtSci(s.plsBz, "e-3")})`
        );
        lines.push(`run(${fmtSci(s.plsTon, "e-9")})`);
        if (s.plsToff > 0) {
          c("Pulso desligado (evolução livre)", "Pulse OFF (free evolution)");
          lines.push(`B_ext = vector(0, 0, 0)`);
          lines.push(`run(${fmtSci(s.plsToff, "e-9")})`);
        }
      } else if (s.dynMode === "hysteresis") {
        const tiltRad = (s.hystTilt * Math.PI) / 180;
        const cTilt = fmtNum(Math.cos(tiltRad), 6);
        const sTilt = fmtNum(Math.sin(tiltRad), 6);
        let vecExpr = `vector(B, 0, 0)`;
        if (s.hystAxis === "x") {
          vecExpr = s.hystTilt > 0 ? `vector(B*${cTilt}, B*${sTilt}, 0)` : `vector(B, 0, 0)`;
        } else if (s.hystAxis === "y") {
          vecExpr = s.hystTilt > 0 ? `vector(B*${sTilt}, B*${cTilt}, 0)` : `vector(0, B, 0)`;
        } else {
          vecExpr = s.hystTilt > 0 ? `vector(B*${sTilt}, 0, B*${cTilt})` : `vector(0, 0, B)`;
        }

        lines.push(`Bmax  := ${fmtSci(s.hystBmax, "e-3")}`);
        lines.push(`Bstep := ${fmtSci(s.hystBstep, "e-3")}`);
        lines.push(`for B := Bmax; B >= -Bmax; B = B - Bstep {`);
        lines.push(`    B_ext = ${vecExpr}`);
        lines.push(`    ${s.hystSolver}()`);
        lines.push(`    TableSave()`);
        lines.push(`}`);
        if (s.hystCycle === "full") {
          lines.push(`for B := -Bmax + Bstep; B <= Bmax; B = B + Bstep {`);
          lines.push(`    B_ext = ${vecExpr}`);
          lines.push(`    ${s.hystSolver}()`);
          lines.push(`    TableSave()`);
          lines.push(`}`);
        }
      } else if (s.dynMode === "sinc_fmr") {
        const b0 = fmtSci(s.sincB0, "e-3");
        const fc = fmtSci(s.sincFc, "e9");
        const t0 = fmtSci(s.sincT0, "e-9");
        const expr = `${b0} * sinc(2*pi*${fc}*(t - ${t0}))`;
        const vec =
          s.sincAxis === "x"
            ? `vector(${expr}, 0, 0)`
            : s.sincAxis === "y"
            ? `vector(0, ${expr}, 0)`
            : `vector(0, 0, ${expr})`;
        lines.push(`B_ext = ${vec}`);
        lines.push(`run(${fmtSci(s.sincTot, "e-9")})`);
      } else if (s.dynMode === "stt_zl") {
        lines.push(`Pol = ${fmtNum(s.sttPol, 4)}`);
        lines.push(`Xi  = ${fmtNum(s.sttXi, 4)}`);
        lines.push(`J   = vector(${fmtSci(s.sttJx, "e11")}, ${fmtSci(s.sttJy, "e11")}, 0)`);
        lines.push(`run(${fmtSci(s.sttNs, "e-9")})`);
      }

      lines.push("");
    }

    // CÓDIGO EXTRA CUSTOMIZADO
    if (s.extraCode && s.extraCode.trim().length > 0) {
      c("Código personalizado adicional", "Custom extra code");
      lines.push(s.extraCode.trim());
      lines.push("");
    }

    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // ---------- Syntax Highlighter (Dark Theme matching app_orca0) ----------
  function highlightMx3(code) {
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const keywords = new Set([
      "SetGridSize", "SetCellSize", "SetPBC", "SetGeom", "EdgeSmooth",
      "Msat", "Aex", "alpha", "EnableDemag", "Ku1", "anisU", "Kc1",
      "Dind", "Dbulk", "Temp", "ThermSeed", "B_ext", "Pol", "Xi", "J",
      "SetSolver", "FixDt", "MaxErr", "OutputFormat",
      "TableAdd", "TableSave", "TableAutoSave", "Save", "SaveAs",
      "Snapshot", "SnapshotAs", "Autosave", "relax", "minimize", "run", "for"
    ]);

    const funcs = new Set([
      "circle", "ellipse", "cuboid", "imageShape", "sub", "add", "intersect",
      "vector", "uniform", "randomMag", "randomMagSeed", "vortex", "twoDomain",
      "neelSkyrmion", "blochSkyrmion", "LoadFile", "sinc", "sin", "cos", "pi"
    ]);

    return escaped
      .split("\n")
      .map((line) => {
        const commentIdx = line.indexOf("//");
        let codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
        const commentPart =
          commentIdx >= 0 ? `<span class="tok-comment">${line.slice(commentIdx)}</span>` : "";

        // Tokenize strings, numbers, identifiers
        codePart = codePart.replace(
          /("[^"]*")|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g,
          (match, strTok, numTok, idTok) => {
            if (strTok) return `<span class="tok-string">${strTok}</span>`;
            if (numTok) return `<span class="tok-number">${numTok}</span>`;
            if (idTok) {
              if (keywords.has(idTok)) return `<span class="tok-keyword">${idTok}</span>`;
              if (funcs.has(idTok)) return `<span class="tok-func">${idTok}</span>`;
            }
            return match;
          }
        );

        return codePart + commentPart;
      })
      .join("\n");
  }

  // ---------- Physics Diagnostics & Numerical Checks ----------
  function updateDiagnostics(s) {
    const isEn = appState.lang === "en";
    const Msat = s.msatKAm * 1e3; // A/m
    const Aex = s.aexPJm * 1e-12; // J/m
    const Ku1 = s.ku1KJm3 * 1e3;  // J/m^3

    const lexNm = Msat > 0 && Aex > 0 ? Math.sqrt((2 * Aex) / (MU0 * Msat * Msat)) * 1e9 : Infinity;
    const deltaNm = Ku1 > 0 && Aex > 0 ? Math.sqrt(Aex / Ku1) * 1e9 : Infinity;
    const Q = Msat > 0 ? (2 * Ku1) / (MU0 * Msat * Msat) : 0;
    const totalCells = s.nx * s.ny * s.nz;

    $("badge-dims").textContent = `${fmtNum(s.lxNm, 4)} × ${fmtNum(s.lyNm, 4)} × ${fmtNum(s.lzNm, 4)} nm³`;
    $("val-lex").textContent = Number.isFinite(lexNm) ? `${lexNm.toFixed(2)} nm` : "—";
    $("val-delta").textContent = Number.isFinite(deltaNm) ? `${deltaNm.toFixed(2)} nm` : "∞ (Ku1 ≤ 0)";
    $("val-q").textContent = Msat > 0 ? Q.toFixed(2) : "—";
    $("val-cells").textContent = totalCells.toLocaleString(isEn ? "en-US" : "pt-BR");

    // SI hints
    $("hint-msat").textContent = `= ${fmtSci(s.msatKAm, "e3")} A/m`;
    $("hint-aex").textContent = `= ${fmtSci(s.aexPJm, "e-12")} J/m`;
    $("hint-ku1").textContent = `= ${fmtSci(s.ku1KJm3, "e3")} J/m³`;
    if ($("hint-kc1")) $("hint-kc1").textContent = `= ${fmtSci(s.kc1KJm3, "e3")} J/m³`;
    if ($("hint-dmi")) $("hint-dmi").textContent = `= ${fmtSci(s.dmiMJm2, "e-3")} J/m²`;

    // Energy free terms active/inactive
    const hasZeeman =
      (s.eqOp !== "none" && (Math.abs(s.eqBx) > 0 || Math.abs(s.eqBy) > 0 || Math.abs(s.eqBz) > 0)) ||
      ["field_run", "pulse_run", "hysteresis", "sinc_fmr"].includes(s.dynMode);
    const hasAnis = Math.abs(s.ku1KJm3) > 0 || Math.abs(s.kc1KJm3) > 0;
    const hasDmi = s.dmiType !== "none" && Math.abs(s.dmiMJm2) > 0;

    setTermActive("term-ex", s.aexPJm > 0);
    setTermActive("term-d", s.enableDemag && s.msatKAm > 0);
    setTermActive("term-anis", hasAnis);
    setTermActive("term-z", hasZeeman);
    setTermActive("term-dmi", hasDmi);

    // Validation messages
    const msgs = [];
    let severity = 0; // 0 ok, 1 warn, 2 err
    const pushMsg = (lvl, text) => {
      if (lvl === "err") severity = Math.max(severity, 2);
      else if (lvl === "warn") severity = Math.max(severity, 1);
      msgs.push({ lvl, text });
    };

    const maxPlaneCell = Math.max(s.cxNm, s.cyNm);
    const minPlaneCell = Math.min(s.cxNm, s.cyNm);

    if (Number.isFinite(lexNm)) {
      if (maxPlaneCell > lexNm) {
        pushMsg(
          "err",
          isEn
            ? `Cell (${maxPlaneCell.toFixed(2)} nm) > l_ex (${lexNm.toFixed(2)} nm): mesh too coarse to resolve gradients!`
            : `Célula (${maxPlaneCell.toFixed(2)} nm) > l_ex (${lexNm.toFixed(2)} nm): malha grossa demais para resolver gradientes!`
        );
      } else if (maxPlaneCell > 0.75 * lexNm) {
        pushMsg(
          "warn",
          isEn
            ? `Cell (${maxPlaneCell.toFixed(2)} nm) is close to l_ex (${lexNm.toFixed(2)} nm). Suggested start: ~${(lexNm / 2).toFixed(1)} nm.`
            : `Célula (${maxPlaneCell.toFixed(2)} nm) próxima de l_ex (${lexNm.toFixed(2)} nm). Recomendado: ~${(lexNm / 2).toFixed(1)} nm.`
        );
      } else if (minPlaneCell >= 0.5) {
        pushMsg(
          "ok",
          isEn
            ? `Cell (${s.cxNm.toFixed(2)}×${s.cyNm.toFixed(2)} nm) resolves l_ex (${lexNm.toFixed(2)} nm) well.`
            : `Célula (${s.cxNm.toFixed(2)}×${s.cyNm.toFixed(2)} nm) resolve bem l_ex (${lexNm.toFixed(2)} nm).`
        );
      }
    }

    // Slide 9: Warning for overly fine cells (atomic regime)
    if (minPlaneCell < 0.5 || s.czNm < 0.5) {
      pushMsg(
        "warn",
        isEn
          ? `Cell < 0.5 nm approaches atomic spacing — exits the continuum micromagnetic approximation!`
          : `Célula < 0.5 nm aproxima-se da escala atômica — pode sair da validade do modelo micromagnético contínuo!`
      );
    }

    if (Number.isFinite(deltaNm) && maxPlaneCell > deltaNm) {
      pushMsg(
        "err",
        isEn
          ? `Cell (${maxPlaneCell.toFixed(2)} nm) > Bloch wall width Δ (${deltaNm.toFixed(2)} nm): risk of numerical pinning.`
          : `Célula (${maxPlaneCell.toFixed(2)} nm) > largura de parede Δ (${deltaNm.toFixed(2)} nm): risco de pinning numérico.`
      );
    }

    // FFT prime factor check
    const badDims = [
      ["Nx", s.nx],
      ["Ny", s.ny],
      ["Nz", s.nz]
    ].filter(([, v]) => largestPrimeFactor(v) > 7);
    if (badDims.length > 0) {
      const desc = badDims.map(([k, v]) => `${k}=${v}`).join(", ");
      pushMsg(
        "warn",
        isEn
          ? `GPU FFT warning (${desc}): large prime factors slow down demag. Prefer factors of 2, 3, 5, 7.`
          : `FFT na GPU (${desc}): fatores primos grandes deixam o demag lento. Prefira potências de 2 ou fatores 2, 3, 5, 7.`
      );
    }

    // Geometry fit check
    if (s.geomType === "circle" && s.geomDiam > Math.min(s.lxNm, s.lyNm) + 1e-6) {
      pushMsg(
        "warn",
        isEn
          ? `Disk diameter (${s.geomDiam} nm) exceeds box size (${fmtNum(s.lxNm)}×${fmtNum(s.lyNm)} nm) and will be clipped.`
          : `Diâmetro do disco (${s.geomDiam} nm) excede a caixa (${fmtNum(s.lxNm)}×${fmtNum(s.lyNm)} nm) e será recortado.`
      );
    }
    if (s.geomType === "ring" && s.geomRin >= s.geomRout) {
      pushMsg(
        "err",
        isEn
          ? `Ring inner diameter must be smaller than outer diameter.`
          : `O diâmetro interno do anel deve ser menor que o externo.`
      );
    }

    // EnableDemag = false reminder
    if (!s.enableDemag) {
      pushMsg(
        "warn",
        isEn
          ? `EnableDemag = false: magnetostatic / shape anisotropy interaction is OFF.`
          : `EnableDemag = false: interação magnetostática / anisotropia de forma está DESLIGADA.`
      );
    }

    // Hysteresis symmetry check
    if (s.dynMode === "hysteresis" && s.hystTilt === 0) {
      pushMsg(
        "warn",
        isEn
          ? `Hysteresis tilt = 0°: exact alignment can trap m at m×B = 0. Consider 0.5°–1°.`
          : `Desalinhamento = 0° na histerese: alinhamento exato pode travar em m×B = 0. Considere 0.5°–1°.`
      );
    }

    // Sinc FMR Nyquist check
    if (s.dynMode === "sinc_fmr" && s.tableautoPs > 0) {
      const nyquistPs = 1000 / (2 * s.sincFc);
      if (s.tableautoPs >= nyquistPs) {
        pushMsg(
          "warn",
          isEn
            ? `TableAutoSave (${s.tableautoPs} ps) violates Nyquist for fc=${s.sincFc} GHz (need < ${nyquistPs.toFixed(1)} ps).`
            : `TableAutoSave (${s.tableautoPs} ps) viola Nyquist para fc=${s.sincFc} GHz (use < ${nyquistPs.toFixed(1)} ps).`
        );
      }
    }

    // Thermal solver check
    if (s.tempK > 0 && s.solverId === "default" && s.fixDtFs === 0) {
      pushMsg(
        "warn",
        isEn
          ? `Temp > 0 K with default adaptive RK45: consider SetSolver(2) (Heun) or a small FixDt.`
          : `Temp > 0 K com RK45 adaptativo padrão: considere SetSolver(2) (Heun) ou FixDt fixo.`
      );
    }

    const listEl = $("validation-list");
    listEl.innerHTML = msgs
      .map((m) => `<div class="val-item val-${m.lvl}">${m.text}</div>`)
      .join("");

    const badge = $("badge-health");
    const strings = window.MUMAX0_I18N[appState.lang];
    badge.className = "pill " + (severity === 2 ? "pill-err" : severity === 1 ? "pill-warn" : "pill-ok");
    badge.textContent = severity === 2 ? strings.status_err : severity === 1 ? strings.status_warn : strings.status_ok;
  }

  function setTermActive(id, active) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("active", Boolean(active));
    el.classList.toggle("inactive", !active);
  }

  // ---------- 2D Canvas Sample & Magnetization Visualizer ----------
  function insideGeometry(xNm, yNm, s) {
    if (s.geomType === "box" || s.geomType === "image") return true;
    if (s.geomType === "circle") {
      const r = s.geomDiam / 2;
      return xNm * xNm + yNm * yNm <= r * r;
    }
    if (s.geomType === "ellipse") {
      const a = s.geomEa / 2;
      const b = s.geomEb / 2;
      return (xNm * xNm) / (a * a) + (yNm * yNm) / (b * b) <= 1;
    }
    if (s.geomType === "ring") {
      const ro = s.geomRout / 2;
      const ri = s.geomRin / 2;
      const r2 = xNm * xNm + yNm * yNm;
      return r2 <= ro * ro && r2 >= ri * ri;
    }
    if (s.geomType === "cuboid") {
      return Math.abs(xNm) <= s.geomCx / 2 && Math.abs(yNm) <= s.geomCy / 2;
    }
    return true;
  }

  function evalInitialM(xNm, yNm, s, rand) {
    let mx = 1, my = 0, mz = 0;
    const scaleR = Math.max(10, Math.min(s.lxNm, s.lyNm) * 0.45);

    if (s.m0Type === "uniform") {
      mx = s.m0Ux; my = s.m0Uy; mz = s.m0Uz;
    } else if (s.m0Type === "random") {
      const phi = rand() * 2 * Math.PI;
      const costh = rand() * 2 - 1;
      const sinth = Math.sqrt(Math.max(0, 1 - costh * costh));
      mx = sinth * Math.cos(phi);
      my = sinth * Math.sin(phi);
      mz = costh;
    } else if (s.m0Type === "vortex") {
      const r = Math.hypot(xNm, yNm);
      const rCore = Math.max(6, scaleR * 0.16);
      const mzVal = s.m0Vpol * Math.exp(-(r * r) / (rCore * rCore));
      const inPlane = Math.sqrt(Math.max(0, 1 - mzVal * mzVal));
      if (r > 1e-6) {
        mx = -s.m0Vcirc * (yNm / r) * inPlane;
        my = s.m0Vcirc * (xNm / r) * inPlane;
      } else {
        mx = 0; my = 0;
      }
      mz = mzVal;
    } else if (s.m0Type === "twodomain") {
      const w = Math.max(8, s.lxNm * 0.08);
      if (xNm < -w) {
        mx = s.td1x; my = s.td1y; mz = s.td1z;
      } else if (xNm > w) {
        mx = s.td2x; my = s.td2y; mz = s.td2z;
      } else {
        mx = s.tdwx; my = s.tdwy; mz = s.tdwz;
      }
    } else if (s.m0Type === "neel_sk" || s.m0Type === "bloch_sk") {
      const r = Math.hypot(xNm, yNm);
      const Rsk = Math.max(12, scaleR * 0.55);
      const theta = Math.PI * Math.exp(-(r * r) / (Rsk * Rsk));
      mz = -s.m0Skq * Math.cos(theta);
      const sinT = Math.sin(theta);
      const phi = Math.atan2(yNm, xNm) + (s.m0Type === "bloch_sk" ? Math.PI / 2 : 0);
      mx = s.m0Skp * sinT * Math.cos(phi);
      my = s.m0Skp * sinT * Math.sin(phi);
    } else {
      mx = 0.7; my = 0.7; mz = 0;
    }

    const norm = Math.hypot(mx, my, mz) || 1;
    return [mx / norm, my / norm, mz / norm];
  }

  function mToHslCss(mx, my, mz) {
    const phi = Math.atan2(my, mx); // -pi..pi
    const hue = ((phi * 180) / Math.PI + 360) % 360;
    const light = 50 + mz * 44; // -1 -> 6%, 0 -> 50%, +1 -> 94%
    const sat = 85 * (1 - 0.65 * Math.abs(mz));
    return `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
  }

  function drawSampleCanvas(s) {
    const canvas = $("sample-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const padL = 44, padR = 26, padT = 24, padB = 38;
    const availW = W - padL - padR;
    const availH = H - padT - padB;
    const aspect = s.lxNm / Math.max(0.01, s.lyNm);

    let drawW = availW;
    let drawH = drawW / aspect;
    if (drawH > availH) {
      drawH = availH;
      drawW = drawH * aspect;
    }
    const ox = padL + (availW - drawW) / 2;
    const oy = padT + (availH - drawH) / 2;

    const showGrid = boolVal("vis-grid");
    const showVecs = boolVal("vis-vectors");
    const showColor = boolVal("vis-color");
    const showBext = boolVal("vis-bext");

    // Bounding box background
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(ox, oy, drawW, drawH);

    // Sample color cells
    const cols = Math.min(48, Math.max(12, Math.round(drawW / 7)));
    const rows = Math.min(48, Math.max(8, Math.round(drawH / 7)));
    const cw = drawW / cols;
    const ch = drawH / rows;
    const randColor = mulberry32(s.m0Seed || 42);

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const u = (i + 0.5) / cols - 0.5;
        const v = 0.5 - (j + 0.5) / rows;
        const xNm = u * s.lxNm;
        const yNm = v * s.lyNm;
        if (!insideGeometry(xNm, yNm, s)) continue;

        const [mx, my, mz] = evalInitialM(xNm, yNm, s, randColor);
        ctx.fillStyle = showColor ? mToHslCss(mx, my, mz) : "#dbeafe";
        ctx.fillRect(ox + i * cw, oy + j * ch, cw + 0.6, ch + 0.6);
      }
    }

    // Mesh grid overlay (auto-subsampled if very fine)
    if (showGrid) {
      const gx = Math.min(s.nx, 32);
      const gy = Math.min(s.ny, 24);
      ctx.strokeStyle = "rgba(15, 23, 42, 0.14)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 0; i <= gx; i++) {
        const x = ox + (i / gx) * drawW;
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + drawH);
      }
      for (let j = 0; j <= gy; j++) {
        const y = oy + (j / gy) * drawH;
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + drawW, y);
      }
      ctx.stroke();
    }

    // Geometry contour
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1.6;
    if (s.geomType === "circle") {
      const rx = ((s.geomDiam / 2) / s.lxNm) * drawW;
      const ry = ((s.geomDiam / 2) / s.lyNm) * drawH;
      ctx.beginPath();
      ctx.ellipse(ox + drawW / 2, oy + drawH / 2, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.geomType === "ellipse") {
      const rx = ((s.geomEa / 2) / s.lxNm) * drawW;
      const ry = ((s.geomEb / 2) / s.lyNm) * drawH;
      ctx.beginPath();
      ctx.ellipse(ox + drawW / 2, oy + drawH / 2, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.geomType === "ring") {
      const rxo = ((s.geomRout / 2) / s.lxNm) * drawW;
      const ryo = ((s.geomRout / 2) / s.lyNm) * drawH;
      const rxi = ((s.geomRin / 2) / s.lxNm) * drawW;
      const ryi = ((s.geomRin / 2) / s.lyNm) * drawH;
      ctx.beginPath();
      ctx.ellipse(ox + drawW / 2, oy + drawH / 2, rxo, ryo, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (s.geomRin < s.geomRout) {
        ctx.beginPath();
        ctx.ellipse(ox + drawW / 2, oy + drawH / 2, rxi, ryi, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (s.geomType === "cuboid") {
      const bw = Math.min(drawW, (s.geomCx / s.lxNm) * drawW);
      const bh = Math.min(drawH, (s.geomCy / s.lyNm) * drawH);
      ctx.strokeRect(ox + (drawW - bw) / 2, oy + (drawH - bh) / 2, bw, bh);
    }

    // Outer box border
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.2;
    ctx.setLineDash(s.geomType === "box" ? [] : [4, 3]);
    ctx.strokeRect(ox, oy, drawW, drawH);
    ctx.setLineDash([]);

    // Magnetization vector arrows
    if (showVecs && s.m0Type !== "loadfile") {
      const vCols = Math.min(14, Math.max(5, Math.round(drawW / 26)));
      const vRows = Math.min(10, Math.max(4, Math.round(drawH / 26)));
      const vStepX = drawW / vCols;
      const vStepY = drawH / vRows;
      const arrowLen = Math.min(vStepX, vStepY) * 0.42;
      const randVec = mulberry32(s.m0Seed || 42);

      for (let j = 0; j < vRows; j++) {
        for (let i = 0; i < vCols; i++) {
          const u = (i + 0.5) / vCols - 0.5;
          const v = 0.5 - (j + 0.5) / vRows;
          const xNm = u * s.lxNm;
          const yNm = v * s.lyNm;
          if (!insideGeometry(xNm, yNm, s)) continue;

          const [mx, my, mz] = evalInitialM(xNm, yNm, s, randVec);
          const cx = ox + (i + 0.5) * vStepX;
          const cy = oy + (j + 0.5) * vStepY;
          const inPlane = Math.hypot(mx, my);

          if (inPlane < 0.2) {
            // Draw out-of-plane dot / cross
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(2.6, arrowLen * 0.35), 0, Math.PI * 2);
            ctx.fillStyle = mz >= 0 ? "#ef4444" : "#1d4ed8";
            ctx.fill();
            ctx.strokeStyle = "#0f172a";
            ctx.lineWidth = 1;
            ctx.stroke();
          } else {
            const dx = mx * arrowLen;
            const dy = -my * arrowLen;
            drawArrow(ctx, cx - dx * 0.65, cy - dy * 0.65, cx + dx * 0.85, cy + dy * 0.85, "#0f172a", 1.35, 4.5);
          }
        }
      }
    }

    // Label for ImageShape / LoadFile
    if (s.geomType === "image" || s.m0Type === "loadfile") {
      ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
      ctx.fillRect(ox + 8, oy + 8, 178, 22);
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 11px Segoe UI";
      const lbl = s.geomType === "image" ? `imageShape("${s.geomImg}")` : `LoadFile("${s.m0OvfFile}")`;
      ctx.fillText(lbl, ox + 14, oy + 23);
    }

    // External field arrow overlay (B_ext)
    if (showBext) {
      let bx = 0, by = 0, bz = 0;
      if (s.dynMode === "field_run") {
        bx = s.dynBx; by = s.dynBy; bz = s.dynBz;
      } else if (s.dynMode === "pulse_run") {
        bx = s.plsBx; by = s.plsBy; bz = s.plsBz;
      } else if (s.dynMode === "hysteresis") {
        const rad = (s.hystTilt * Math.PI) / 180;
        if (s.hystAxis === "x") { bx = Math.cos(rad); by = Math.sin(rad); }
        else if (s.hystAxis === "y") { bx = Math.sin(rad); by = Math.cos(rad); }
        else { bx = Math.sin(rad); bz = Math.cos(rad); }
      } else if (s.dynMode === "sinc_fmr") {
        if (s.sincAxis === "x") bx = s.sincB0;
        else if (s.sincAxis === "y") by = s.sincB0;
        else bz = s.sincB0;
      } else if (s.eqOp !== "none") {
        bx = s.eqBx; by = s.eqBy; bz = s.eqBz;
      }

      const bMag = Math.hypot(bx, by, bz);
      if (bMag > 1e-9) {
        const bx0 = ox + drawW - 34;
        const by0 = oy + 26;
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx0 - 28, by0 - 20, 56, 40, 6);
        ctx.fill();
        ctx.stroke();

        const bPlane = Math.hypot(bx, by);
        if (bPlane > 0.1 * bMag) {
          const ux = bx / bPlane;
          const uy = by / bPlane;
          drawArrow(ctx, bx0 - ux * 14, by0 + uy * 14, bx0 + ux * 15, by0 - uy * 15, "#dc2626", 2.2, 6);
        } else {
          ctx.fillStyle = "#dc2626";
          ctx.font = "700 11px Segoe UI";
          ctx.textAlign = "center";
          ctx.fillText(bz >= 0 ? "⊙ +z" : "⊗ −z", bx0, by0 + 4);
        }
        ctx.fillStyle = "#991b1b";
        ctx.font = "700 9.5px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText("B_ext", bx0, by0 + 17);
        ctx.textAlign = "start";
      }
    }

    // Dimension labels
    ctx.fillStyle = "#475569";
    ctx.font = "600 11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(`Lx = ${fmtNum(s.lxNm, 4)} nm  (${s.nx} × ${fmtNum(s.cxNm, 3)} nm)`, ox + drawW / 2, oy + drawH + 17);

    ctx.save();
    ctx.translate(ox - 14, oy + drawH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`Ly = ${fmtNum(s.lyNm, 4)} nm`, 0, 0);
    ctx.restore();
    ctx.textAlign = "start";
  }

  function drawArrow(ctx, x1, y1, x2, y2, color, width, headLen) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  // ---------- Conditional Visibility of Subpanels ----------
  function syncConditionalFields() {
    const cellMode = strVal("cell-mode", "cell");
    $("row-cell-nm").classList.toggle("hidden", cellMode !== "cell");
    $("row-total-nm").classList.toggle("hidden", cellMode !== "total");

    const geom = strVal("geom-type", "box");
    $("geom-circle-row").classList.toggle("hidden", geom !== "circle");
    $("geom-ellipse-row").classList.toggle("hidden", geom !== "ellipse");
    $("geom-ring-row").classList.toggle("hidden", geom !== "ring");
    $("geom-cuboid-row").classList.toggle("hidden", geom !== "cuboid");
    $("geom-image-row").classList.toggle("hidden", geom !== "image");

    const dmiType = strVal("dmi-type", "none");
    $("row-dmi-val").classList.toggle("hidden", dmiType === "none");

    const m0 = strVal("m0-type", "uniform");
    $("m0-uniform-row").classList.toggle("hidden", m0 !== "uniform");
    $("m0-random-row").classList.toggle("hidden", m0 !== "random");
    $("m0-vortex-row").classList.toggle("hidden", m0 !== "vortex");
    $("m0-twodomain-box").classList.toggle("hidden", m0 !== "twodomain");
    $("m0-sk-row").classList.toggle("hidden", m0 !== "neel_sk" && m0 !== "bloch_sk");
    $("m0-load-row").classList.toggle("hidden", m0 !== "loadfile");

    const eqOp = strVal("eq-op", "relax");
    $("row-eq-bext").classList.toggle("hidden", eqOp === "none");
    $("row-eq-saves").classList.toggle("hidden", eqOp === "none");

    const dyn = strVal("dyn-mode", "none");
    ["field_run", "pulse_run", "hysteresis", "sinc_fmr", "stt_zl"].forEach((k) => {
      const panel = $(`sub-${k}`);
      if (panel) panel.classList.toggle("hidden", dyn !== k);
    });
    const showAuto = ["field_run", "pulse_run", "sinc_fmr", "stt_zl"].includes(dyn);
    $("row-autosaves").classList.toggle("hidden", !showAuto);
  }

  // ---------- Didactic Panel ----------
  function showHelp(key) {
    const dict = window.MUMAX0_DIDACTICS[appState.lang] || window.MUMAX0_DIDACTICS.pt;
    const item = dict[key] || dict.welcome;
    appState.activeHelp = key;

    const labels =
      appState.lang === "en"
        ? { p: "Physics & Equation", i: "Intuition & Units", n: "Numerical Care" }
        : { p: "Física & Equação", i: "Intuição & Unidades", n: "Cuidados Numéricos" };

    $("didactic-body").innerHTML = `
      <h4>${item.title}</h4>
      <div class="didactic-section">
        <span class="didactic-tag tag-phys">${labels.p}</span>
        <p>${item.phys}</p>
      </div>
      <div class="didactic-section">
        <span class="didactic-tag tag-intuit">${labels.i}</span>
        <p>${item.intuit}</p>
      </div>
      <div class="didactic-section">
        <span class="didactic-tag tag-num">${labels.n}</span>
        <p>${item.num}</p>
      </div>
    `;
  }

  // ---------- i18n Update ----------
  function applyLanguage(lang) {
    appState.lang = lang;
    const strings = window.MUMAX0_I18N[lang];
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const k = el.getAttribute("data-i18n");
      if (strings[k] !== undefined) {
        el.innerHTML = strings[k];
      }
    });
    $("ui-app-subtitle").textContent = strings.app_subtitle;
    showHelp(appState.activeHelp);
    updateAll();
  }

  // ---------- Complexity Mode (Basic vs Advanced) ----------
  function setMode(mode) {
    appState.mode = mode;
    document.body.classList.toggle("mode-basic", mode === "basic");
    $("btn-mode-basic").classList.toggle("active", mode === "basic");
    $("btn-mode-adv").classList.toggle("active", mode === "advanced");

    // If switching back to basic while an advanced select option is chosen, fall back cleanly
    if (mode === "basic") {
      if (["neel_sk", "bloch_sk", "loadfile"].includes($("m0-type").value)) {
        $("m0-type").value = "uniform";
      }
      if (["sinc_fmr", "stt_zl"].includes($("dyn-mode").value)) {
        $("dyn-mode").value = "none";
      }
    }
    updateAll();
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    const el = $("toast-msg");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  // ---------- Master Update ----------
  function updateAll() {
    syncConditionalFields();
    const s = readFormState();
    updateDiagnostics(s);
    drawSampleCanvas(s);

    const code = generateMx3(s);
    appState.lastGeneratedCode = code;

    if (!appState.manualEdit) {
      $("code-highlight").innerHTML = highlightMx3(code);
      $("code-editor").value = code;
    }

    $("cli-cmd").textContent = `mumax3 -vet ${s.filename} && mumax3 -f ${s.filename}`;
  }

  function getActiveCode() {
    return appState.manualEdit ? $("code-editor").value : appState.lastGeneratedCode;
  }

  // ---------- Save / Load JSON Config ----------
  function collectRawInputs() {
    const data = { _meta: { app: "MUMAX0", mode: appState.mode, lang: appState.lang } };
    document.querySelectorAll(".form-pane input, .form-pane select, .form-pane textarea, #script-filename").forEach((el) => {
      if (!el.id) return;
      data[el.id] = el.type === "checkbox" ? el.checked : el.value;
    });
    return data;
  }

  function applyRawInputs(data) {
    if (data._meta && data._meta.mode) setMode(data._meta.mode);
    Object.keys(data).forEach((id) => {
      if (id === "_meta") return;
      const el = $(id);
      if (!el) return;
      if (el.type === "checkbox") el.checked = Boolean(data[id]);
      else el.value = data[id];
    });
    updateAll();
  }

  // ---------- Event Wiring ----------
  function init() {
    // Store initial default snapshot for Reset button
    const initialDefaults = collectRawInputs();

    // Step tabs
    document.querySelectorAll(".step-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = btn.getAttribute("data-step");
        appState.activeStep = Number(step);
        document.querySelectorAll(".step-tab").forEach((b) => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".step-panel").forEach((p) => {
          p.classList.toggle("active", p.getAttribute("data-panel") === step);
        });
        const stepHelpMap = { "1": "grid_size", "2": "msat", "3": "init_m", "4": "operations", "5": "outputs" };
        showHelp(stepHelpMap[step] || "welcome");
      });
    });

    // Mode switch
    $("btn-mode-basic").addEventListener("click", () => setMode("basic"));
    $("btn-mode-adv").addEventListener("click", () => setMode("advanced"));

    // Language switch
    $("sel-lang").addEventListener("change", (e) => applyLanguage(e.target.value));

    // Form changes (only inside generator tab so viewer controls don't regenerate .mx3)
    document.querySelectorAll("#tab-generator input, #tab-generator select, #tab-generator textarea").forEach((el) => {
      if (el.id === "sel-lang" || el.id === "file-import-json" || el.id === "code-editor" || el.id === "chk-manual-edit") {
        return;
      }
      el.addEventListener("input", updateAll);
      el.addEventListener("change", updateAll);
    });

    // Help triggers on click / focus
    document.querySelectorAll("[data-help]").forEach((el) => {
      const helpKey = el.getAttribute("data-help");
      el.addEventListener("click", () => showHelp(helpKey));
      el.addEventListener("focusin", () => showHelp(helpKey));
    });

    // Manual edit mode toggle
    $("chk-manual-edit").addEventListener("change", (e) => {
      appState.manualEdit = e.target.checked;
      $("code-highlight").classList.toggle("hidden", appState.manualEdit);
      $("code-editor").classList.toggle("hidden", !appState.manualEdit);
      if (appState.manualEdit) {
        $("code-editor").value = appState.lastGeneratedCode;
        $("code-editor").focus();
      } else {
        $("code-highlight").innerHTML = highlightMx3(appState.lastGeneratedCode);
      }
    });

    // Copy helper with file:// fallback
    function copyTextRobust(text, toastText) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => showToast(toastText),
          () => fallbackCopy(text, toastText)
        );
      } else {
        fallbackCopy(text, toastText);
      }
    }

    function fallbackCopy(text, toastText) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showToast(toastText);
      } catch (err) {
        alert("Não foi possível copiar automaticamente: " + err.message);
      } finally {
        document.body.removeChild(ta);
      }
    }

    // Copy .mx3
    $("btn-copy-mx3").addEventListener("click", () => {
      copyTextRobust(getActiveCode(), window.MUMAX0_I18N[appState.lang].toast_copied);
    });

    // Copy CLI command
    $("btn-copy-cli").addEventListener("click", () => {
      copyTextRobust($("cli-cmd").textContent, window.MUMAX0_I18N[appState.lang].toast_cli_copied);
    });

    // Download .mx3
    $("btn-download-mx3").addEventListener("click", () => {
      const fname = sanitizeFilename(strVal("script-filename", "simulacao.mx3"));
      const blob = new Blob([getActiveCode()], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
      showToast(window.MUMAX0_I18N[appState.lang].toast_downloaded);
    });

    // Export JSON config
    $("btn-export-json").addEventListener("click", () => {
      const cfg = collectRawInputs();
      const base = sanitizeFilename(strVal("script-filename", "simulacao.mx3")).replace(/\.mx3$/i, "");
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}_config.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(window.MUMAX0_I18N[appState.lang].toast_saved_cfg);
    });

    // Import JSON config
    $("btn-import-json").addEventListener("click", () => $("file-import-json").click());
    $("file-import-json").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          applyRawInputs(parsed);
          showToast(window.MUMAX0_I18N[appState.lang].toast_loaded_cfg);
        } catch (err) {
          alert("Erro ao ler arquivo JSON: " + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    // Reset button
    $("btn-reset").addEventListener("click", () => {
      appState.manualEdit = false;
      $("chk-manual-edit").checked = false;
      $("code-highlight").classList.remove("hidden");
      $("code-editor").classList.add("hidden");
      applyRawInputs(initialDefaults);
      showToast(window.MUMAX0_I18N[appState.lang].toast_reset);
    });

    // Expose generator for automated CLI verification
    window.MUMAX0_API = { readFormState, generateMx3 };

    // ---------- Local MuMax3 Bridge (server.js) ----------
    const bridge = {
      online: false,
      mumaxExists: false,
      mumaxPath: "",
      workDir: "",
      gpu: 0,
      forceOverwrite: true,
      httpUi: false,
      lastOutDir: "",
      pollTimer: null
    };

    function updateServerBadge() {
      const badge = $("badge-server");
      if (!badge) return;
      const isEn = appState.lang === "en";
      if (!bridge.online) {
        const isWeb = window.location.protocol === "http:" || window.location.protocol === "https:";
        badge.className = "pill pill-info";
        badge.textContent = isWeb ? (isEn ? "🌐 Web Mode" : "🌐 Modo Web") : (isEn ? "⚪ Static" : "⚪ Estático");
        badge.title = isEn
          ? "Web mode (generator + local .ovf viewer). To run mumax3 on your GPU, download the repo and launch Abrir_MUMAX0.bat or abrir_mumax0.sh"
          : "Modo web (gerador + visualizador de .ovf). Para rodar o mumax3 na sua GPU, baixe o repositório e abra com Abrir_MUMAX0.bat ou abrir_mumax0.sh";
      } else if (!bridge.mumaxExists) {
        badge.className = "pill pill-warn";
        badge.textContent = isEn ? "⚠ Set mumax3.exe" : "⚠ Configurar exe";
        badge.title = bridge.mumaxPath;
      } else {
        badge.className = "pill pill-ok";
        badge.textContent = `🟢 MuMax3 (GPU ${bridge.gpu})`;
        badge.title = bridge.mumaxPath;
      }
    }

    async function fetchServerStatus() {
      if (window.location.protocol === "file:") {
        bridge.online = false;
        updateServerBadge();
        return null;
      }
      try {
        const resp = await fetch("/api/status", { cache: "no-store" });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        bridge.online = true;
        bridge.mumaxExists = Boolean(data.mumaxExists);
        bridge.mumaxPath = data.mumaxPath || "";
        bridge.workDir = data.workDir || "";
        bridge.gpu = data.gpu ?? 0;
        bridge.forceOverwrite = Boolean(data.forceOverwrite);
        bridge.httpUi = Boolean(data.httpUi);
        updateServerBadge();
        if (data.job) renderJobState(data.job);
        return data;
      } catch (_) {
        bridge.online = false;
        updateServerBadge();
        return null;
      }
    }

    function openConfigModal() {
      $("cfg-offline-banner").classList.toggle("hidden", bridge.online);
      $("cfg-mumax-path").value = bridge.mumaxPath || "";
      $("cfg-work-dir").value = bridge.workDir || "";
      $("cfg-gpu").value = bridge.gpu;
      $("cfg-force").checked = bridge.forceOverwrite;
      $("cfg-http").checked = bridge.httpUi;
      const hint = $("cfg-exe-status");
      if (!bridge.online) {
        hint.textContent = "";
        hint.className = "field-hint";
      } else if (bridge.mumaxExists) {
        hint.textContent = appState.lang === "en" ? "✔ Executable found" : "✔ Executável encontrado";
        hint.className = "field-hint ok";
      } else {
        hint.textContent = appState.lang === "en" ? "✖ Executable not found at this path" : "✖ Executável não encontrado nesse caminho";
        hint.className = "field-hint err";
      }
      $("btn-save-config").disabled = !bridge.online;
      $("btn-open-workdir").disabled = !bridge.online;
      if ($("cfg-local-fieldset")) $("cfg-local-fieldset").disabled = !bridge.online;
      $("modal-config").classList.remove("hidden");
    }

    function closeConfigModal() {
      $("modal-config").classList.add("hidden");
    }

    async function saveConfigFromModal() {
      if (!bridge.online) return;
      const payload = {
        mumaxPath: $("cfg-mumax-path").value.trim(),
        workDir: $("cfg-work-dir").value.trim(),
        gpu: parseInt($("cfg-gpu").value, 10) || 0,
        forceOverwrite: $("cfg-force").checked,
        httpUi: $("cfg-http").checked
      };
      const resp = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (data.ok) {
        bridge.mumaxExists = Boolean(data.mumaxExists);
        bridge.mumaxPath = data.mumaxPath;
        bridge.workDir = data.workDir;
        bridge.gpu = data.gpu;
        bridge.forceOverwrite = data.forceOverwrite;
        bridge.httpUi = data.httpUi;
        updateServerBadge();
        closeConfigModal();
        showToast(appState.lang === "en" ? "✔ MuMax3 settings saved!" : "✔ Configurações do MuMax3 salvas!");
      }
    }

    function openConsoleModal() {
      $("modal-console").classList.remove("hidden");
    }

    function closeConsoleModal() {
      $("modal-console").classList.add("hidden");
    }

    function renderJobState(j) {
      if (!j) return;
      const isEn = appState.lang === "en";
      const pill = $("console-status-pill");
      const map = {
        idle: ["pill-muted", isEn ? "Idle" : "Inativo"],
        running: ["pill-info", isEn ? "⏳ Running..." : "⏳ Executando..."],
        done: ["pill-ok", isEn ? "✔ Finished" : "✔ Concluído"],
        error: ["pill-err", isEn ? "✖ Error" : "✖ Erro"],
        cancelled: ["pill-warn", isEn ? "⏹ Cancelled" : "⏹ Cancelado"]
      };
      const [cls, txt] = map[j.status] || map.idle;
      pill.className = "pill " + cls;
      pill.textContent = txt;

      if (j.startedAt) {
        const end = j.finishedAt ? new Date(j.finishedAt).getTime() : Date.now();
        const sec = Math.max(0, (end - new Date(j.startedAt).getTime()) / 1000);
        $("console-timer").textContent = `${sec.toFixed(1)} s`;
      } else {
        $("console-timer").textContent = "";
      }

      if (j.outDir) bridge.lastOutDir = j.outDir;
      $("console-meta").textContent = j.scriptPath ? `${j.scriptPath}  →  ${j.outDir}` : "";

      const logEl = $("console-log");
      if (typeof j.log === "string" && j.log.length > 0) {
        const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
        logEl.textContent = j.log;
        if (atBottom) logEl.scrollTop = logEl.scrollHeight;
      }

      $("btn-stop-job").disabled = !j.running;
      $("btn-run-mx3").disabled = j.running;
      const btnView = $("btn-view-results");
      if (btnView) {
        btnView.classList.toggle("hidden", j.status !== "done");
      }
    }

    function switchMainTab(tabName, preferredOutDir = "") {
      const isViewer = tabName === "viewer";
      $("tab-generator").classList.toggle("hidden", isViewer);
      $("tab-viewer").classList.toggle("hidden", !isViewer);
      $("btn-tab-generator").classList.toggle("active", !isViewer);
      $("btn-tab-viewer").classList.toggle("active", isViewer);

      if (isViewer && window.MUMAX0_VIEWER) {
        window.MUMAX0_VIEWER.refreshOutputs(preferredOutDir).then(() => {
          requestAnimationFrame(() => window.MUMAX0_VIEWER.redraw());
        });
      }
    }

    function startPolling() {
      stopPolling();
      bridge.pollTimer = setInterval(async () => {
        const data = await fetchServerStatus();
        if (!data || !data.job || !data.job.running) {
          stopPolling();
        }
      }, 450);
    }

    function stopPolling() {
      if (bridge.pollTimer) {
        clearInterval(bridge.pollTimer);
        bridge.pollTimer = null;
      }
    }

    async function ensureBridgeReady() {
      await fetchServerStatus();
      if (!bridge.online) {
        openConfigModal();
        return false;
      }
      if (!bridge.mumaxExists) {
        openConfigModal();
        return false;
      }
      return true;
    }

    async function runVetCheck() {
      if (!(await ensureBridgeReady())) return;
      const fname = sanitizeFilename(strVal("script-filename", "simulacao.mx3"));
      openConsoleModal();
      const pill = $("console-status-pill");
      pill.className = "pill pill-info";
      pill.textContent = appState.lang === "en" ? "⏳ Validating (-vet)..." : "⏳ Validando (-vet)...";
      $("console-meta").textContent = `mumax3 -vet ${fname}`;
      $("console-log").textContent = appState.lang === "en" ? "Running syntax check...\n" : "Verificando sintaxe com mumax3 -vet...\n";
      $("btn-stop-job").disabled = true;

      try {
        const resp = await fetch("/api/vet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: fname, code: getActiveCode() })
        });
        const data = await resp.json();
        if (data.ok) {
          pill.className = "pill pill-ok";
          pill.textContent = appState.lang === "en" ? "✔ Syntax OK" : "✔ Sintaxe OK";
          $("console-log").textContent = `✅ mumax3 -vet ${fname}\n\n${data.output}`;
        } else {
          pill.className = "pill pill-err";
          pill.textContent = appState.lang === "en" ? "✖ Syntax Error" : "✖ Erro de Sintaxe";
          $("console-log").textContent = `❌ mumax3 -vet ${fname}\n\n${data.output || data.error}`;
        }
      } catch (err) {
        pill.className = "pill pill-err";
        pill.textContent = "✖ Erro";
        $("console-log").textContent = String(err.message || err);
      }
    }

    async function runSimulation() {
      if (!(await ensureBridgeReady())) return;
      const fname = sanitizeFilename(strVal("script-filename", "simulacao.mx3"));
      openConsoleModal();
      try {
        const resp = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: fname,
            code: getActiveCode(),
            gpu: bridge.gpu,
            forceOverwrite: bridge.forceOverwrite,
            httpUi: bridge.httpUi
          })
        });
        const data = await resp.json();
        if (!data.ok) {
          $("console-status-pill").className = "pill pill-err";
          $("console-status-pill").textContent = "✖ Erro";
          $("console-log").textContent = `❌ ${data.error}`;
          return;
        }
        renderJobState(data.job);
        startPolling();
      } catch (err) {
        $("console-log").textContent = `❌ ${err.message}`;
      }
    }

    async function stopSimulation() {
      if (!bridge.online) return;
      await fetch("/api/stop", { method: "POST" });
      await fetchServerStatus();
    }

    async function openFolderOnHost(folderPath) {
      if (!bridge.online) return;
      await fetch("/api/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: folderPath || bridge.workDir })
      });
    }

    // Wire MuMax3 UI buttons
    $("btn-config-mumax").addEventListener("click", async () => {
      await fetchServerStatus();
      openConfigModal();
    });
    if ($("badge-server")) {
      $("badge-server").addEventListener("click", async () => {
        await fetchServerStatus();
        openConfigModal();
      });
    }
    $("btn-close-config").addEventListener("click", closeConfigModal);
    $("btn-cancel-config").addEventListener("click", closeConfigModal);
    $("btn-save-config").addEventListener("click", saveConfigFromModal);
    $("btn-open-workdir").addEventListener("click", () => openFolderOnHost(bridge.workDir));

    $("btn-vet-mx3").addEventListener("click", runVetCheck);
    $("btn-run-mx3").addEventListener("click", runSimulation);
    $("btn-open-console").addEventListener("click", async () => {
      await fetchServerStatus();
      openConsoleModal();
    });
    $("btn-close-console").addEventListener("click", closeConsoleModal);
    $("btn-dismiss-console").addEventListener("click", closeConsoleModal);
    $("btn-stop-job").addEventListener("click", stopSimulation);
    $("btn-open-outdir").addEventListener("click", () => openFolderOnHost(bridge.lastOutDir || bridge.workDir));
    $("btn-view-results").addEventListener("click", () => {
      closeConsoleModal();
      switchMainTab("viewer", bridge.lastOutDir);
    });

    // Main top tabs (Gerador vs Visualização)
    $("btn-tab-generator").addEventListener("click", () => switchMainTab("generator"));
    $("btn-tab-viewer").addEventListener("click", () => switchMainTab("viewer"));

    // Close modals clicking backdrop
    $("modal-config").addEventListener("click", (e) => {
      if (e.target === $("modal-config")) closeConfigModal();
    });
    $("modal-console").addEventListener("click", (e) => {
      if (e.target === $("modal-console")) closeConsoleModal();
    });

    // Initialize default view
    setMode("basic");
    showHelp("welcome");
    updateAll();
    fetchServerStatus().then((data) => {
      if (data && data.job && data.job.running) startPolling();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
