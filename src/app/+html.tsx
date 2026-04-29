import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Root HTML template for Expo web builds.
 * Adds SEO meta tags, Open Graph / social preview, and PWA theme colour.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* Primary meta */}
        <title>ConnectHub – Find &amp; Hire Service Providers</title>
        <meta
          name="description"
          content="ConnectHub connects you with verified local service providers. Post a job, get accepted, and pay securely — all in one place."
        />
        <meta name="theme-color" content="#0f172a" />
        <meta name="application-name" content="ConnectHub" />

        {/* Open Graph (Facebook, WhatsApp, LinkedIn) */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="ConnectHub" />
        <meta property="og:title" content="ConnectHub – Find &amp; Hire Service Providers" />
        <meta
          property="og:description"
          content="ConnectHub connects you with verified local service providers. Post a job, get accepted, and pay securely — all in one place."
        />
        <meta property="og:url" content="https://connecthub-1873e.web.app" />

        {/* Twitter card */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="ConnectHub – Find &amp; Hire Service Providers" />
        <meta
          name="twitter:description"
          content="ConnectHub connects you with verified local service providers. Post a job, get accepted, and pay securely."
        />

        {/* PWA */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ConnectHub" />

        {/*
         * Expo Router's ScrollViewStyleReset prevents layout shifts on web by
         * resetting body/html default overflow styles.
         */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
