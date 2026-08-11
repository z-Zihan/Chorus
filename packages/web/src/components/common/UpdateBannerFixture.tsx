import { useEffect } from "react";
import { UpdateBanner } from "@/components/common/UpdateBanner";
import { ToastContainer } from "@/components/common/ToastContainer";
import { announceUpdate, type UpdateInfo } from "@/services/updater";

const fixtureUpdate = {
  version: "0.2.0",
  downloadAndInstall: async (onEvent: (event: unknown) => void) => {
    onEvent({ event: "Started", data: { contentLength: 1_024 } });
    onEvent({ event: "Progress", data: { chunkLength: 1_024 } });
    onEvent({ event: "Finished", data: {} });
  },
} as unknown as UpdateInfo;

export function UpdateBannerFixture() {
  useEffect(() => {
    announceUpdate(fixtureUpdate);
  }, []);

  return (
    <main className="flex h-screen flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <UpdateBanner />
      <div className="flex-1" />
      <ToastContainer />
    </main>
  );
}
