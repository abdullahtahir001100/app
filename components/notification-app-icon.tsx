"use client";

type NotificationAppIconProps = {
  app: string;
  icon?: string | null;
  image?: string | null;
  className?: string;
  color?: string;
};

function isRenderableSrc(value?: string | null): value is string {
  if (!value || typeof value !== "string") return false;
  const v = value.trim();
  return (
    v.startsWith("data:image/") ||
    v.startsWith("data:image/svg") ||
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("/")
  );
}

/** Prefer real notification icon/image from the device — not Lucide placeholders. */
export function NotificationAppIcon({
  app,
  icon,
  image,
  className = "w-6 h-6",
  color = "#6B7280",
}: NotificationAppIconProps) {
  const iconSrc = isRenderableSrc(icon) ? icon : null;
  const imageSrc = isRenderableSrc(image) ? image : null;
  const src = iconSrc || imageSrc;

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={`${className} object-cover rounded-md`} />
    );
  }

  const letter = (app || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      role="img"
    >
      <rect x="2" y="2" width="20" height="20" rx="6" fill={`${color}22`} />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill={color}
        fontFamily="system-ui, sans-serif"
      >
        {letter}
      </text>
    </svg>
  );
}
