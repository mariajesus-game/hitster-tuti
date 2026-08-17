/* ══════════════════════════════════════════════════════════════
   HITSTER TUTI — Autenticación con Spotify (PKCE, sin servidor)
   Compartido por index.html (reproductor) y buscador.html.

   PKCE permite autenticarse sin "client secret", que es justo lo que
   necesitamos: todo el código es público (está en GitHub Pages) y aun
   así nadie puede robarse credenciales.
   ══════════════════════════════════════════════════════════════ */

const SP = (() => {
  const AUTH   = 'https://accounts.spotify.com/authorize';
  const TOKEN  = 'https://accounts.spotify.com/api/token';
  const API    = 'https://api.spotify.com/v1';
  const SCOPES = 'user-read-playback-state user-modify-playback-state';
  const LS     = 'hitster_tuti_sp';

  const guardar = d => localStorage.setItem(LS, JSON.stringify(d));
  const leer    = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };

  /** URL de esta página sin query ni hash — debe coincidir EXACTO con
   *  la "Redirect URI" registrada en el dashboard de Spotify. */
  const redirectUri = () => location.origin + location.pathname;

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function reto(verifier) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(hash);
  }

  /* ── Iniciar sesión: redirige a Spotify ── */
  async function entrar(clientId, volverA) {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
    sessionStorage.setItem('sp_verifier', verifier);
    sessionStorage.setItem('sp_client',   clientId);
    // El hash se pierde en el redirect, así que lo guardamos aparte
    sessionStorage.setItem('sp_volver',   volverA || location.hash || '');

    const p = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: await reto(verifier),
      scope: SCOPES
    });
    location.href = AUTH + '?' + p;
  }

  /* ── Al volver de Spotify: canjear el código por un token ── */
  async function capturarRetorno() {
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    if (!code) return q.get('error') ? { error: q.get('error') } : null;

    const verifier = sessionStorage.getItem('sp_verifier');
    const clientId = sessionStorage.getItem('sp_client');
    const volver   = sessionStorage.getItem('sp_volver') || '';
    sessionStorage.removeItem('sp_verifier');

    const r = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, grant_type: 'authorization_code', code,
        redirect_uri: redirectUri(), code_verifier: verifier
      })
    });
    const d = await r.json();
    if (!r.ok) return { error: d.error_description || d.error || 'fallo al canjear el código' };

    guardar({ ...d, clientId, expira: Date.now() + (d.expires_in - 60) * 1000 });
    // Limpiar ?code= de la barra y restaurar la carta que se venía a abrir
    history.replaceState({}, '', redirectUri() + volver);
    return { ok: true, volver };
  }

  /* ── Token vigente, renovando si hace falta ── */
  async function token() {
    const s = leer();
    if (!s) return null;
    if (Date.now() < s.expira) return s.access_token;
    if (!s.refresh_token) { salir(); return null; }

    const r = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: s.clientId, grant_type: 'refresh_token', refresh_token: s.refresh_token
      })
    });
    if (!r.ok) { salir(); return null; }
    const d = await r.json();
    guardar({ ...s, ...d, expira: Date.now() + (d.expires_in - 60) * 1000 });
    return d.access_token;
  }

  const activa = () => !!leer();
  const salir  = () => localStorage.removeItem(LS);

  /* ── Llamada genérica a la Web API ── */
  async function api(ruta, opciones = {}) {
    const t = await token();
    if (!t) throw new Error('sin sesión');
    const r = await fetch(API + ruta, {
      ...opciones,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opciones.headers || {}) }
    });
    if (r.status === 204) return null;                       // sin contenido (play/pause)
    if (r.status === 401) { salir(); throw new Error('sesión vencida'); }
    if (r.status === 403) throw new Error('Spotify rechazó la orden (¿la cuenta es Premium?)');
    if (r.status === 404) throw new Error('no hay ningún dispositivo Spotify activo');
    if (r.status === 429) throw new Error('demasiadas peticiones, espera unos segundos');
    if (!r.ok) throw new Error('error ' + r.status + ' de Spotify');
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  /* ── Atajos de reproducción ── */
  const dispositivos = () => api('/me/player/devices').then(d => (d && d.devices) || []);
  const estado       = () => api('/me/player');

  /** posMs: desde qué milisegundo arrancar (para no partir siempre por la intro) */
  const tocar = (trackId, deviceId, posMs) => api(
    '/me/player/play' + (deviceId ? '?device_id=' + deviceId : ''),
    { method: 'PUT', body: JSON.stringify({
        uris: ['spotify:track:' + trackId],
        position_ms: Math.max(0, Math.round(posMs || 0)) }) }
  );

  /** Duración de una pista en segundos (para calcular dónde empezar). */
  const duracion = async trackId => {
    try{ const t = await api('/tracks/' + trackId); return t ? t.duration_ms / 1000 : null; }
    catch(e){ return null; }
  };
  const pausar   = () => api('/me/player/pause', { method: 'PUT' });
  const reanudar = () => api('/me/player/play',  { method: 'PUT' });

  return { entrar, capturarRetorno, activa, salir, api, token,
           dispositivos, estado, tocar, pausar, reanudar, duracion, redirectUri };
})();
