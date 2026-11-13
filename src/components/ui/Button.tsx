import { cn } from "../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>({
  props: {
    className = "",
    ...props,
  },
  ref,
}) => {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none",
        "focus-visible:ring-primary-600 dark:focus-visible:ring-primary-500",
        props.className,
      )}
      ref={ref}
      {...props}
    />
  );
});

Button.displayName = "Button";