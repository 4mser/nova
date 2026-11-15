/* Tu QR para NOVA Station: el código lo da la nave (POST /v1/qr), sirve una sola vez y vence en 60 s; se pide uno
   nuevo cada 30 s, así una foto o una captura deja de servir enseguida. Lo usan el pase del perfil y la pantalla grande. */
import { useEffect, useState } from 'react';
import { leerNave, useNave } from './nave';

export const QR_CADA = 30;

export function useQrNave(activo = true) {
  const nave = useNave();
  const [codigo, setCodigo] = useState<string | null>(null), [error, setError] = useState(''), [quedan, setQuedan] = useState(QR_CADA);
  useEffect(() => {
    if (!activo || !nave.url) return;
    let vivo = true, n = QR_CADA;
    const pedir = async () => {
      const nv = leerNave();
      try {
        const r = await fetch(`${nv.url}/v1/qr`, { method: 'POST', headers: { 'content-type': 'application/json', ...(nv.token ? { 'x-nova-token': nv.token } : {}) }, body: JSON.stringify({ trip: nv.asiento }) });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (vivo) { setCodigo(j.codigo); setError(''); }
      } catch { if (vivo) setError('nave'); }
    };
    pedir();
    const id = setInterval(() => { n -= 1; if (n <= 0) { n = QR_CADA; pedir(); } if (vivo) setQuedan(n); }, 1000);
    return () => { vivo = false; clearInterval(id); };
  }, [activo, nave.url, nave.asiento, nave.token]);
  return { codigo: activo && nave.url ? codigo : null, error, quedan, enlazada: !!nave.url, asiento: nave.asiento };
}
