"use client";

type Props = {
  businessName: string;
  keyword: string;
};

function slugify(s: string, fallback: string): string {
  const out = s
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return out || fallback;
}

export function PrintButton({ businessName, keyword }: Props) {
  function handleClick() {
    const bizSlug = slugify(businessName || "", "report");
    const kwSlug = slugify(keyword || "", "");
    const filename = kwSlug
      ? `${bizSlug}_${kwSlug}_report`
      : `${bizSlug}_report`;

    // Browsers use document.title as the default "Save as PDF" filename.
    // Swap it for the print dialog, then restore on afterprint so the
    // tab/history entry doesn't keep the filename string.
    const original = document.title;
    document.title = filename;
    const restore = () => {
      document.title = original;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  return (
    <button onClick={handleClick} className="rp-print-btn">
      Print / Save as PDF
    </button>
  );
}
