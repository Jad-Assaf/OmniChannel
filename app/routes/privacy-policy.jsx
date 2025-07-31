import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-primary mb-2">
            Privacy Policy
          </h1>
          <p className="text-muted-foreground">
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </div>

        <div className="prose prose-gray max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">
              1. Information We Collect
            </h2>
            <p className="text-muted-foreground mb-4">
              We collect information you provide directly to us, such as when
              you create an account, use our WhatsApp Business API management
              platform, or contact us for support.
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Account information (username, business details)</li>
              <li>WhatsApp Business API configuration data</li>
              <li>Message metadata and conversation analytics</li>
              <li>Usage statistics and performance metrics</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">
              2. How We Use Your Information
            </h2>
            <p className="text-muted-foreground mb-4">
              We use the information we collect to provide, maintain, and
              improve our services:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Facilitate WhatsApp Business API integrations</li>
              <li>Provide customer support and technical assistance</li>
              <li>Analyze usage patterns to improve our platform</li>
              <li>Send important service notifications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">
              3. WhatsApp Integration
            </h2>
            <p className="text-muted-foreground mb-4">
              Our platform integrates with WhatsApp Business API through Meta's
              official channels:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>We use Meta's Embedded Signup for secure authentication</li>
              <li>
                Message content is processed in accordance with WhatsApp's
                policies
              </li>
              <li>We maintain end-to-end encryption standards</li>
              <li>Business verification follows Meta's requirements</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">
              4. Data Security
            </h2>
            <p className="text-muted-foreground mb-4">
              We implement appropriate security measures to protect your
              information:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Encrypted data transmission and storage</li>
              <li>Regular security audits and updates</li>
              <li>Access controls and authentication protocols</li>
              <li>Compliance with industry security standards</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">
              5. Third-Party Services
            </h2>
            <p className="text-muted-foreground mb-4">
              Our platform integrates with the following third-party services:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Meta WhatsApp Business API</li>
              <li>Meta Business Manager</li>
              <li>Cloud hosting providers</li>
              <li>Analytics and monitoring services</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">
              6. Data Retention
            </h2>
            <p className="text-muted-foreground mb-4">
              We retain your information for as long as necessary to provide our
              services and comply with legal obligations:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Account data: Until account deletion</li>
              <li>Message metadata: 90 days for analytics</li>
              <li>Audit logs: 1 year for security purposes</li>
              <li>Business verification data: As required by Meta</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">
              7. Your Rights
            </h2>
            <p className="text-muted-foreground mb-4">You have the right to:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Access and download your data</li>
              <li>Correct inaccurate information</li>
              <li>Delete your account and associated data</li>
              <li>Opt out of non-essential communications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">
              8. Contact Us
            </h2>
            <p className="text-muted-foreground">
              If you have any questions about this Privacy Policy, please
              contact us at privacy@yourcompany.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
