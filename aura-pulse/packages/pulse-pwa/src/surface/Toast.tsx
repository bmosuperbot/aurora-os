import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  duration?: number;
  onDone: () => void;
}

export function Toast({ message, duration = 2500, onDone }: ToastProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setExiting(true), duration - 300);
    const doneTimer = setTimeout(onDone, duration);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [duration, onDone]);

  return (
    <div className={`aura-toast${exiting ? " aura-toast--exiting" : ""}`}>
      {message}
    </div>
  );
}
