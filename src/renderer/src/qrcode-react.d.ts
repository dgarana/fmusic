declare module 'qrcode.react' {
  import type { ComponentType, SVGProps } from 'react';

  export interface QRCodeSVGProps extends SVGProps<SVGSVGElement> {
    value: string;
    size?: number;
    level?: 'L' | 'M' | 'Q' | 'H';
    includeMargin?: boolean;
    marginSize?: number;
    imageSettings?: {
      src: string;
      height: number;
      width: number;
      excavate?: boolean;
    };
  }

  export const QRCodeSVG: ComponentType<QRCodeSVGProps>;
}
