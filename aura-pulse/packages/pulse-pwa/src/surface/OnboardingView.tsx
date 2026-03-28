import type { OnboardingStatusItem } from "../ws/protocol.js";

interface OnboardingViewProps {
  items: OnboardingStatusItem[];
  onDismiss: () => void;
}

function statusIcon(status: OnboardingStatusItem["status"]): string {
  switch (status) {
    case "installed": return "✓";
    case "missing":   return "○";
    case "pending":   return "○";
    default:          return "+";
  }
}

function statusLabel(status: OnboardingStatusItem["status"]): string {
  switch (status) {
    case "installed":     return "installed";
    case "missing":       return "tap to set up";
    case "pending":       return "tap to set up";
    case "not-installed": return "coming soon";
  }
}

export function OnboardingView({ items, onDismiss }: OnboardingViewProps) {
  const required = items.filter((i) => i.tier === "required");
  const optional = items.filter((i) => i.tier === "optional");
  const allRequiredDone = required.every((i) => i.status === "installed");

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <h2 className="onboarding-title">Setting up Studio Ops</h2>

        <section className="onboarding-section">
          <h3 className="onboarding-section-title">Required</h3>
          <ul className="onboarding-list">
            {required.map((item) => (
              <li key={item.id} className={`onboarding-item onboarding-item--${item.status}`}>
                <span className="onboarding-icon">{statusIcon(item.status)}</span>
                <span className="onboarding-label">{item.label}</span>
                <span className="onboarding-status-text">{statusLabel(item.status)}</span>
              </li>
            ))}
          </ul>
        </section>

        {optional.length > 0 && (
          <section className="onboarding-section">
            <h3 className="onboarding-section-title">Optional — Expert Store</h3>
            <ul className="onboarding-list">
              {optional.map((item) => (
                <li key={item.id} className={`onboarding-item onboarding-item--${item.status}`}>
                  <span className="onboarding-icon">{statusIcon(item.status)}</span>
                  <span className="onboarding-label">{item.label}</span>
                  <span className="onboarding-status-text">{statusLabel(item.status)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button
          className="onboarding-continue"
          onClick={onDismiss}
          disabled={!allRequiredDone}
        >
          {allRequiredDone ? "Continue" : "Finish setup to continue"}
        </button>
      </div>
    </div>
  );
}
