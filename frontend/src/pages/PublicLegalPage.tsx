import type { ReactNode } from 'react';

type LegalPageKind = 'privacy' | 'terms' | 'data-deletion';

const contact = 'info@swaragh.com';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3"><h2 className="text-xl font-semibold text-slate-900">{title}</h2><div className="space-y-3 leading-7 text-slate-700">{children}</div></section>;
}

export function PublicLegalPage({ kind }: { kind: LegalPageKind }) {
  const title = kind === 'privacy' ? 'Privacy Policy' : kind === 'terms' ? 'Terms of Service' : 'Data Deletion Instructions';

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:py-16">
      <main className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm sm:p-10">
        <header className="mb-10 border-b border-slate-200 pb-6">
          <a href="https://swaragh.com" className="text-sm font-semibold text-blue-700 hover:underline">Swaragh Technologies</a>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-slate-600">Swaragh CRM · Last updated 16 October 2026</p>
        </header>

        <div className="space-y-9">
          {kind === 'privacy' && <>
            <Section title="Who we are"><p>Swaragh Technologies operates Swaragh CRM for its own agency lead management, outreach, and newsletters. Contact us at <a className="text-blue-700 underline" href={`mailto:${contact}`}>{contact}</a>. Our published office address is #2010, 7th B Main, B Sector, Yelahanka New Town, Bengaluru 560064, Karnataka, India.</p></Section>
            <Section title="Information we process"><p>The service can process account and contact details, lead and company information, form submissions, campaign and newsletter preferences, messages and replies, delivery status, uploaded content, and technical information needed to operate and secure the service. Information may come from you, our website or newsletter forms, our business contacts, connected messaging services, or lead research sources. We use only the information relevant to the activity.</p></Section>
            <Section title="How we use information"><p>We use information to respond to enquiries, manage our business contacts, send our outreach and newsletters where permitted, handle replies and opt-outs, provide support, secure the service, and meet applicable legal obligations. Swaragh is responsible for its own contact lists, notices, permissions, and communication preferences.</p></Section>
            <Section title="Service providers and transfers"><p>Information may be processed by providers used for hosting, email, SMS, WhatsApp messaging, storage, analytics, or AI features when the relevant service is enabled. WhatsApp communications use Meta’s WhatsApp Business Platform. Depending on the integration used, information may be processed outside India. Contact us for details about providers used for a particular service.</p></Section>
            <Section title="Retention and security"><p>We retain information while needed for our business relationship and applicable legal, security, or record-keeping needs. We are establishing a formal retention schedule and will publish specific periods after it is implemented. You may ask us about the period relevant to your information. We use account access controls and other safeguards, but no online service can guarantee absolute security.</p></Section>
            <Section title="Your choices"><p>Subject to applicable law, you may request access, correction, or deletion, or ask us to stop marketing communications, by contacting us. Newsletter messages may contain an unsubscribe link. We may need to verify a request. We will explain if a legal reason requires us to keep some information.</p></Section>
            <Section title="Changes and contact"><p>We may update this policy and will post the revised version here. For privacy or data deletion requests, email <a className="text-blue-700 underline" href={`mailto:${contact}`}>{contact}</a>. Do not email passwords or access tokens.</p></Section>
          </>}

          {kind === 'terms' && <>
            <Section title="Service"><p>Swaragh CRM is an internal tool operated by Swaragh Technologies in India for our agency’s lead management, outreach, newsletters, and customer communications. These terms describe the public-facing use of our forms and communications; they do not offer CRM accounts to the public.</p></Section>
            <Section title="Enquiries and subscriptions"><p>When you submit an enquiry or subscribe to a newsletter, provide accurate contact information and do not send unlawful or harmful material. A newsletter subscription can be ended using its unsubscribe link or by contacting us. We may contact you in response to a request you submit.</p></Section>
            <Section title="Our communications"><p>We seek required permissions before marketing and honor opt-outs. WhatsApp communications are subject to Meta’s applicable terms and messaging policies, including approved templates when required. You may ask us to stop outreach by emailing <a className="text-blue-700 underline" href={`mailto:${contact}`}>{contact}</a>.</p></Section>
            <Section title="Third-party services"><p>Delivery of WhatsApp, email, and SMS depends on connected providers and their terms. A provider may delay, reject, or fail to deliver a communication.</p></Section>
            <Section title="Contact"><p>For questions about these terms or our communications, email <a className="text-blue-700 underline" href={`mailto:${contact}`}>{contact}</a>. For information on personal data, read our <a className="text-blue-700 underline" href="/privacy">Privacy Policy</a>.</p></Section>
          </>}

          {kind === 'data-deletion' && <>
            <Section title="How to request deletion"><p>Email <a className="text-blue-700 underline" href={`mailto:${contact}?subject=Data%20deletion%20request`}>{contact}</a> with the subject “Data deletion request.” Include the phone number or email address involved and, if known, the business that contacted you. Do not send passwords, access tokens, identity documents, or payment card details in your first message.</p></Section>
            <Section title="What happens next"><p>We will review the request, verify it where necessary, locate relevant CRM records, and explain the outcome and any information that must be kept to meet legal or security obligations. We are establishing a documented request-handling process; if you do not receive a reply, please follow up at the same address.</p></Section>
            <Section title="Stopping messages"><p>If you want to stop receiving outreach, tell us or the business that contacted you. Please say if you also want your information deleted; an opt-out and a deletion request are separate requests.</p></Section>
          </>}
        </div>

        <footer className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-200 pt-6 text-sm text-blue-700">
          <a href="/privacy" className="hover:underline">Privacy Policy</a>
          <a href="/terms" className="hover:underline">Terms of Service</a>
          <a href="/data-deletion" className="hover:underline">Data Deletion</a>
        </footer>
      </main>
    </div>
  );
}
