// ===================== ENCRIPTACION DE CONTRASENAS V22 =====================
var _PWD_SECRET = 'LTMCRG_2026_SEC';
var _PWD_PREFIX = 'ENC:';

function encryptPassword(plain) {
  if (!plain) return '';
  var s = plain.toString();
  var key = _PWD_SECRET;
  var bytes = [];
  for (var i = 0; i < s.length; i++) {
    bytes.push(s.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return _PWD_PREFIX + Utilities.base64Encode(bytes);
}

function decryptPassword(enc) {
  if (!enc) return '';
  enc = enc.toString().trim();
  if (enc.indexOf(_PWD_PREFIX) !== 0) return enc;
  try {
    var b64 = enc.substring(_PWD_PREFIX.length);
    var bytes = Utilities.base64Decode(b64);
    var key = _PWD_SECRET;
    var plain = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      plain += String.fromCharCode(b ^ key.charCodeAt(i % key.length));
    }
    return plain;
  } catch(e) { return enc; }
}

function getCustomPassword(email) {
  // V24 SPEED: Check cache first
  var cache = CacheService.getScriptCache();
  var cachedPass = cache.get('CUSTPASS_' + email);
  _log('[V2-CUSTPASS] email=' + email + ' cachedPass=' + (cachedPass === null ? 'NULL' : cachedPass === '__NONE__' ? '__NONE__' : cachedPass === '__EMPTY__' ? '__EMPTY__' : 'ENCRYPTED(len=' + (cachedPass||'').length + ')'));
  if (cachedPass === '__NONE__') return null;
  if (cachedPass === '__EMPTY__') return null;
  if (cachedPass) {
    try {
      var decrypted = decryptPassword(cachedPass);
      _log('[V2-CUSTPASS] Decrypted from cache: len=' + (decrypted||'').length);
      return decrypted;
    } catch(e) {
      _log('[V2-CUSTPASS] Decrypt FAILED, removing stale cache');
      cache.remove('CUSTPASS_' + email);
    }
  }
  try {
    var ss = getSpreadsheet('MAESTRO');
    var sh = ss.getSheetByName('Contrase\u00f1as') || ss.getSheetByName('Contrasenas');
    if (!sh) { _log('[V2-CUSTPASS] Hoja Contraseñas NO EXISTE'); cache.put('CUSTPASS_' + email, '__NONE__', CACHE_LOGIN); return null; }
    var data = sh.getDataRange().getValues();
    _log('[V2-CUSTPASS] Hoja Contraseñas tiene ' + data.length + ' filas (incluye header)');
    for (var i = 1; i < data.length; i++) {
      var rowEmail = (data[i][0] || '').toString().trim().toLowerCase();
      if (rowEmail === email) {
        var stored = (data[i][1] || '').toString().trim();
        _log('[V2-CUSTPASS] ENCONTRADO en fila ' + (i+1) + ' stored_len=' + stored.length + ' stored_empty=' + (!stored));
        if (!stored) {
          cache.put('CUSTPASS_' + email, '__EMPTY__', CACHE_LOGIN);
          return null;
        }
        try { cache.put('CUSTPASS_' + email, stored, CACHE_LOGIN); } catch(ce) {}
        return decryptPassword(stored);
      }
    }
    _log('[V2-CUSTPASS] NO encontrado en hoja → __NONE__');
    cache.put('CUSTPASS_' + email, '__NONE__', CACHE_LOGIN);
  } catch(e) {
    var _cpMsg = e.message || String(e);
    _auditLog('[V76-CUSTPASS] ERROR al leer contrasena: email=' + email + ' ssId=' + (IDS.MAESTRO || '?') + ' error=' + _cpMsg);
  }
  return null;
}

// V42b: Validación de contraseña — relajada: min 8 chars + (numero O especial)
function validarPasswordSeguro(pass) {
  if (!pass || pass.length < 8) return { ok: false, error: 'La contrase\u00f1a debe tener m\u00ednimo 8 caracteres.' };
  var tieneNumero = /[0-9]/.test(pass);
  var tieneEspecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pass);
  if (!tieneNumero && !tieneEspecial) return { ok: false, error: 'Debe incluir al menos un n\u00famero o un car\u00e1cter especial.' };
  return { ok: true };
}

function cambiarPassword(email, newPass, bp) {
  // V42: Validar contraseña segura en backend
  var valResult = validarPasswordSeguro(newPass);
  if (!valResult.ok) return { success: false, error: valResult.error };

  // V76: Audit trail detallado para diagnosticar errores de permisos
  var _audit = { email: email, bp: bp || '', paso: '', ssId: '', sheetName: '', error: '' };
  var ssId = IDS.MAESTRO || '(no definido)';
  _audit.ssId = ssId;

  try {
    _audit.paso = '1-openSpreadsheet';
    var ss = getSpreadsheet('MAESTRO');
    if (!ss) {
      _audit.error = 'getSpreadsheet retorno null';
      _auditLog('[PASS-AUDIT] FALLO: ' + JSON.stringify(_audit));
      return { success: false, error: 'No se pudo abrir la hoja MAESTRO (ID: ' + ssId + '). Verifique que el ID es correcto y que el propietario del script tiene acceso.' };
    }

    _audit.paso = '2-getSheet';
    var sh = ss.getSheetByName('Contrase\u00f1as') || ss.getSheetByName('Contrasenas');
    // V42: Crear hoja con columna BP si no existe
    if (!sh) {
      _audit.paso = '2b-createSheet';
      sh = ss.insertSheet('Contrase\u00f1as');
      sh.appendRow(['EMAIL', 'PASSWORD', 'FECHA', 'BP']);
    }
    _audit.sheetName = sh.getName();

    _audit.paso = '3-readHeaders';
    // V42: Asegurar que la columna BP exista (headers)
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var colBP = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      if ((headers[hi] || '').toString().toUpperCase().trim() === 'BP') { colBP = hi + 1; break; }
    }
    if (colBP < 0) {
      _audit.paso = '3b-addBPColumn';
      colBP = headers.length + 1;
      sh.getRange(1, colBP).setValue('BP');
    }

    _audit.paso = '4-encrypt';
    var encrypted = encryptPassword(newPass);

    _audit.paso = '5-readData';
    var data = sh.getDataRange().getValues();
    var found = false;

    _audit.paso = '6-writePassword';
    for (var i = 1; i < data.length; i++) {
      if ((data[i][0] || '').toString().trim().toLowerCase() === email.toLowerCase()) {
        sh.getRange(i + 1, 2).setValue(encrypted);
        sh.getRange(i + 1, 3).setValue(new Date());
        // V42: Guardar BP en la hoja Contraseñas
        if (bp) sh.getRange(i + 1, colBP).setValue(bp);
        found = true; break;
      }
    }
    if (!found) {
      _audit.paso = '6b-appendNewRow';
      var newRow = [email.toLowerCase(), encrypted, new Date()];
      // V42: Agregar BP si se proporcionó
      while (newRow.length < colBP - 1) newRow.push('');
      newRow.push(bp || '');
      sh.appendRow(newRow);
    }

    // V24 SPEED: Invalidate password and login caches
    try {
      var cache = CacheService.getScriptCache();
      cache.removeAll(['CUSTPASS_' + email.toLowerCase(), 'USERLOGIN_' + email.toLowerCase()]);
    } catch(ce) {}

    _auditLog('[PASS-AUDIT] OK: email=' + email + ' bp=' + (bp || '') + ' found=' + found + ' sheet=' + _audit.sheetName + ' ssId=' + ssId);
    return { success: true };
  } catch(e) {
    // V76: Mensaje detallado con paso exacto, spreadsheet ID y hoja
    var msg = e.message || String(e);
    _audit.error = msg;
    _auditLog('[PASS-AUDIT] FALLO: ' + JSON.stringify(_audit));

    var esPermisos = (msg.indexOf('permiso') >= 0 || msg.indexOf('permission') >= 0 || msg.indexOf('denied') >= 0 || msg.indexOf('acceder') >= 0 || msg.indexOf('You do not have') >= 0);
    if (esPermisos) {
      return {
        success: false,
        error: 'Error de permisos al guardar contrasena.'
          + '\nPaso que fallo: ' + _audit.paso
          + '\nSpreadsheet ID: ' + ssId
          + '\nHoja: ' + (_audit.sheetName || 'Contrasenas')
          + '\n\nSolucion: El administrador debe verificar:'
          + '\n1) Que el Web App este desplegado como "Ejecutar como: Yo (propietario)" en Apps Script > Deploy > Manage deployments.'
          + '\n2) Que el propietario del script tenga permisos de EDICION sobre la hoja MAESTRO.'
          + '\nContacte al admin con este mensaje.'
      };
    }
    return { success: false, error: 'Error en paso ' + _audit.paso + ': ' + msg + ' (SS: ' + ssId + ', Hoja: ' + (_audit.sheetName || 'Contrasenas') + ')' };
  }
}

/**
 * Migrar contrasenas existentes (texto plano) a formato encriptado.
 * Ejecutar UNA VEZ desde el editor de Apps Script.
 */
function migrarContrasenas() {
  var ss = getSpreadsheet('MAESTRO');
  var sh = ss.getSheetByName('Contrase\u00f1as') || ss.getSheetByName('Contrasenas');
  if (!sh) return { success: false, error: 'Hoja Contrasenas no encontrada' };
  var data = sh.getDataRange().getValues();
  var migrated = 0;
  for (var i = 1; i < data.length; i++) {
    var pass = (data[i][1] || '').toString().trim();
    if (!pass) continue;
    if (pass.indexOf(_PWD_PREFIX) === 0) continue;
    var encrypted = encryptPassword(pass);
    sh.getRange(i + 1, 2).setValue(encrypted);
    migrated++;
  }
  Logger.log('migrarContrasenas: ' + migrated + ' contrasenas migradas');
  return { success: true, migrated: migrated };
}

// ===================== RESET DE CONTRASENA (CODIGO 6 DIGITOS) =====================
function solicitarCodigoReset(email) {
  email = (email || '').toString().trim().toLowerCase();
  if (!email) return { success: false, error: 'Email es requerido.' };

  var existe = false;
  try {
    var ss = getSpreadsheet('MAESTRO');
    var shAdmin = ss.getSheetByName('Admins');
    if (shAdmin) {
      var admins = shAdmin.getDataRange().getDisplayValues();
      for (var i = 1; i < admins.length; i++) {
        if ((admins[i][1] || '').toString().trim().toLowerCase() === email) { existe = true; break; }
      }
    }
  } catch(e) {}

  if (!existe) {
    var bases = ['CHILE', 'RAMPA', 'LATAM', 'NAM'];
    for (var b = 0; b < bases.length && !existe; b++) {
      try {
        var cfg = CONFIG_BASE[bases[b]];
        var ss2 = getSpreadsheet(bases[b]);
        var sh = ss2.getSheetByName(TABS[bases[b]].base);
        if (!sh) continue;
        var data = sh.getDataRange().getDisplayValues();
        for (var r = 1; r < data.length; r++) {
          if ((data[r][cfg.correo] || '').toString().trim().toLowerCase() === email) { existe = true; break; }
        }
      } catch(e) {}
    }
  }

  if (!existe) return { success: false, error: 'Email no registrado en el sistema.' };

  var codigo = '';
  for (var c = 0; c < 6; c++) codigo += Math.floor(Math.random() * 10);

  var cache = CacheService.getScriptCache();
  cache.put('RESET_' + email, codigo, 600);

  try {
    MailApp.sendEmail({
      to: email,
      subject: 'Codigo de recuperacion - Portal Cargo Training',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:30px;background:#f8fafc;border-radius:12px;">' +
        '<div style="text-align:center;margin-bottom:24px;"><h2 style="color:#1e293b;margin:0;">Portal Cargo Training</h2><p style="color:#64748b;font-size:14px;">Recuperacion de contrasena</p></div>' +
        '<div style="background:white;padding:24px;border-radius:8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">' +
        '<p style="color:#374151;font-size:14px;margin-bottom:16px;">Tu codigo de verificacion es:</p>' +
        '<div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#4f46e5;padding:16px;background:#f1f5f9;border-radius:8px;display:inline-block;">' + codigo + '</div>' +
        '<p style="color:#94a3b8;font-size:12px;margin-top:16px;">Este codigo expira en 10 minutos.</p></div>' +
        '<p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:16px;">Si no solicitaste este codigo, ignora este correo.</p></div>'
    });
  } catch(e) {
    return { success: false, error: 'Error enviando correo: ' + e.message };
  }

  return { success: true, message: 'Codigo enviado a ' + email };
}

function resetPasswordConCodigo(email, codigo, newPass) {
  email = (email || '').toString().trim().toLowerCase();
  codigo = (codigo || '').toString().trim();
  if (!email || !codigo || !newPass) return { success: false, error: 'Todos los campos son requeridos.' };
  // V42: Validar contraseña segura en backend
  var valResult = validarPasswordSeguro(newPass);
  if (!valResult.ok) return { success: false, error: valResult.error };

  var cache = CacheService.getScriptCache();
  var stored = cache.get('RESET_' + email);
  if (!stored) return { success: false, error: 'Codigo expirado. Solicita uno nuevo.' };
  if (stored !== codigo) return { success: false, error: 'Codigo incorrecto.' };

  cache.remove('RESET_' + email);
  return cambiarPassword(email, newPass);
}

// V78-SEC: getContrasenaUsuario ELIMINADA — nunca devolver contraseñas al frontend
// V78-SEC: getListaContrasenas ELIMINADA — nunca devolver lista de contraseñas al frontend
// V78-SEC: migrarContrasenas mantiene solo el backend, sin UI para invocarla

/**
 * Enviar correo desde el sistema.
 * @param {string} destinatario - Email del destinatario
 * @param {string} asunto - Asunto del correo
 * @param {string} cuerpo - Cuerpo del correo (HTML)
 * @returns {Object} { success, message }
 */
function enviarCorreoSistema(destinatario, asunto, cuerpo) {
  try {
    if (!destinatario || !asunto || !cuerpo) {
      return { success: false, message: 'Faltan campos obligatorios.' };
    }
    MailApp.sendEmail({
      to: destinatario,
      subject: asunto,
      htmlBody: cuerpo
    });
    return { success: true, message: 'Correo enviado a ' + destinatario };
  } catch(e) {
    return { success: false, message: 'Error al enviar: ' + e.message };
  }
}
