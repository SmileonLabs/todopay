import { TabsContent } from "@/components/ui/tabs";
import { PartnerPayments } from "@/components/partner-payments";
import { usePartnerPortalContext } from "@/contexts/partner-portal-context";

export function PartnerPaymentsSection() {
  const { request, activeSection } = usePartnerPortalContext();
  return (
    <TabsContent value="payments" className="space-y-6">
      <PartnerPayments
        active={activeSection === "payments"}
        request={request}
      />
    </TabsContent>
  );
}
