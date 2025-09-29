import { forwardRef } from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", ...props }, ref) => {
    const baseClass = "btn";
    const variantClass = variant === "outline" ? "btn-outline" : "btn-primary";
    const finalClassName = `${baseClass} ${variantClass} ${className}`.trim();

    return (
      <button
        className={finalClassName}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };