'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function JoinQr({ url, size = 200 }: { url: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    void QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      color: { dark: '#ededed', light: '#00000000' },
    }).then(setSvg);
  }, [url]);
  return (
    <div
      style={{ width: size, height: size }}
      aria-label="Join QR code"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
