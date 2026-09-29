import { CustomerForm } from '@/components/customer/CustomerForm';
import { TopBar } from '@/components/TopBar';
import { t } from '@/lib/copy';
import { requireCurrentContext } from '@/server/auth/current';

export const dynamic = 'force-dynamic';

/** "Naya customer" from the Customers tab: someone to bill later, added now. */
export default async function NewCustomerPage() {
  const { business } = await requireCurrentContext();
  return (
    <>
      <TopBar title={t('customer.new.title')} sub={t('customer.new.sub')} back={{ href: '/customers' }} />
      <main className="page">
        <CustomerForm
          businessId={business.id}
          customerId={null}
          initial={{
            name: '',
            contactPerson: '',
            phone: '',
            gstin: '',
            pan: '',
            addressLine1: '',
            city: '',
            pincode: '',
            stateCode: business.stateCode ?? '',
            language: '',
          }}
          suggestion={null}
        />
      </main>
    </>
  );
}
