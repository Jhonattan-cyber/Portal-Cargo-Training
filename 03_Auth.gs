// ===================== ENTRY POINT =====================
function doGet(e) {
  // V2.7: Custom favicon for MENTE app
  var faviconUrl = 'https://i.postimg.cc/8CnZ9Cff/Icono-Color.png';

  // V2: Handle boss approval view (public, token-based)
  if (e && e.parameter && e.parameter.view === 'aprobacion') {
    var tpl = HtmlService.createTemplateFromFile('aprobacion_jefe');
    tpl.eventoId = e.parameter.evt || '';
    tpl.token = e.parameter.token || '';
    return tpl.evaluate()
      .setTitle('Validacion de Participantes — LATAM Cargo')
      .setFaviconUrl(faviconUrl)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('LATAM Cargo - Portal de Capacitaciones')
    .setFaviconUrl(faviconUrl)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(filename) {
  var content = HtmlService.createTemplateFromFile(filename).evaluate().getContent();
  if (filename === 'forecast') {
    content += '<script>' +
    '/* V104-PATCH: Fix inyectado desde backend (Codigo.gs) para HCC + ejecutivo JEFE */' +
    'console.error("%c[V104-PATCH] Parche backend INYECTADO","background:#7c3aed;color:white;font-size:14px;padding:4px 8px;border-radius:4px;font-weight:bold;");' +
    'var _v104origPoblar=window.poblarFiltroJefes;' +
    'window.poblarFiltroJefes=function(){' +
    '  _v104origPoblar.apply(this,arguments);' +
    '  if(window.currentUser&&window.currentUser.role==="JEFE"){' +
    '    filtrosFc.ejecutivo="";' +
    '    var s=document.getElementById("fc-ejecutivo");if(s)s.value="";' +
    '    console.log("[V104-PATCH] ejecutivo limpiado para JEFE puro");' +
    '  }' +
    '};' +
    'var _v104origRender=window.renderForecastMatriz;' +
    'window.renderForecastMatriz=function(){' +
    '  var bp=window._basesPermitidas||[];' +
    '  if(bp.indexOf("HCC")<0){' +
    '    var d=typeof getDatosActuales==="function"?getDatosActuales():null;' +
    '    if(d&&d.forecast)d.forecast.forEach(function(r){r.esHCC=false;});' +
    '  }' +
    '  if(window.currentUser&&window.currentUser.role==="JEFE"){' +
    '    filtrosFc.ejecutivo="";' +
    '    var s=document.getElementById("fc-ejecutivo");if(s)s.value="";' +
    '  }' +
    '  return _v104origRender.apply(this,arguments);' +
    '};' +
    '</script>';
  }
  if (filename === 'planificacion') {
    // V96: Safety net — solo aplica restricciones de Capacity si el HTML aun tiene V95
    var usr2 = getUsuarioActual();
    var rol2 = usr2 ? (usr2.rol || '').toUpperCase() : '';
    content += '<script>';
    content += 'window._planRol=window._planRol||"' + rol2 + '";';
    content += 'window._planEsCapacity=(window._planRol==="CAPACITY");';
    content += 'console.log("[V96-PLAN] rol=' + rol2 + '");';
    content += '</script>';
  }
  return content;
}
