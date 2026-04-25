/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Old public URL: the audit form used to live at /audit. The form is
      // now the site root, so any saved bookmark or external link still works.
      { source: "/audit", destination: "/", permanent: true },
    ];
  },
};
export default nextConfig;
