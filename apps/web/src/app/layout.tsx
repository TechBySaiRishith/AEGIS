export const metadata = {
  title: "AEGIS AI Safety Lab",
  description: "Adversarial evaluation and governance for AI systems",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
