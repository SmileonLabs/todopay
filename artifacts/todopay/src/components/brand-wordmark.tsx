import logo from "@/assets/todopay-logo-white.png";

export function BrandWordmark({ className = "h-20 w-auto" }: { className?: string }) {
  return <img src={logo} alt="TodoPay" className={className} />;
}
