import type { NextraLayoutProps } from 'nextra';

export default function App({ Component, pageProps }: NextraLayoutProps) {
  return <Component {...pageProps} />;
}