import Link from 'next/link';

import { CustomerPicker } from '@/components/customer/CustomerPicker';
import { GuideButton } from '@/components/guide/GuideButton';
import { Icon } from '@/components/Icon';
import { TaskCard } from '@/components/home/TaskCard';
import { VoiceButton } from '@/components/voice/VoiceButton';
import { t, tCount } from '@/lib/copy';
import { moneyForMessage, salutationFor } from '@/lib/copy/messages';
import { financialYearOf, todayIst } from '@/lib/dates';
import { gstTabVisible } from '@/lib/domain/gst-tab';
import { initialOf } from '@/lib/domain/home';
import { peopleRows } from '@/lib/domain/people';
import { profileSetupStatus } from '@/lib/domain/setup-status';
import { requireCurrentContext } from '@/server/auth/current';
import { loadHome } from '@/server/services/home';

import { NewYearBanner } from './NewYearBanner';

export const dynamic = 'force-dynamic';

/**
 * Home is the front desk.
 *
 * You walk in, you are greeted by name, and someone asks "Haan ji, kaise help
 * karein?". Then the few things people come here to do, each a big card in
 * their own words with one line of where it stands, and each opening one
 * screen that does only that. The customers sit to the side like a
 * directory, with a search box.
 */
export default async function HomePage() {
  const { business } = await requireCurrentContext();
  const today = todayIst();
  const home = await loadHome(business.id, today);
  const setup = profileSetupStatus(business, today);
  // "Namaste, Sharma ji" fits; "Namaste, Demo Appliance Repairs (sample)" drowns
  // the greeting. A long name moves to a small line under "Namaste ji".
  const greetName = salutationFor({ name: business.legalName }).replace(/\s*\(sample\)\s*/i, '').trim();
  const nameFits = greetName.length <= 20;
  const people = peopleRows(home);

  const dueSub =
    home.due.length === 0
      ? t('home.due.subEmpty')
      : home.dueFrom === 1
        ? t('task.due.subOne', { amount: moneyForMessage(home.duePaise) })
        : t('task.due.sub', { amount: moneyForMessage(home.duePaise), n: home.dueFrom });

  return (
    <main className="page reception">
      <header className="hello">
        <div className="hello__top">
          <span className="hello__brand">EkBill</span>
          <span className="row row--tight">
            <GuideButton />
            <Link href="/you" className="avatar" aria-label={t('tab.you')}>
              {initialOf(business.legalName)}
            </Link>
          </span>
        </div>
        <h1 className="hello__name">{nameFits ? t('home.greeting', { name: greetName }) : t('home.greetingJi')}</h1>
        {!nameFits && <p className="hello__who">{business.legalName}</p>}
        <p className="hello__ask">{t('home.ask')}</p>
      </header>

      {financialYearOf(today) !== business.activeFinancialYear && (
        <NewYearBanner businessId={business.id} fy={financialYearOf(today)} prefix={business.numbering.prefix} />
      )}

      {!setup.complete && (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span className="grow">{t('home.setup')}</span>
          <Link href="/you" className="btn btn--secondary btn--small">{t('home.setup.go')}</Link>
        </div>
      )}

      <div className="reception__body">
        <section className="stack" aria-labelledby="tasks-heading">
          <h2 id="tasks-heading" className="section-label">{t('home.tasks')}</h2>
          <div className="tasks">
            <TaskCard href="/bills/start" icon="bill-new" title={t('task.bill.title')} sub={t('task.bill.sub')} primary testId="task-bill" />
            <TaskCard
              href="/bills"
              icon="bills"
              title={t('task.sent.title')}
              sub={tCount(home.sentThisMonth, { zero: 'home.sent.subEmpty', one: 'home.sent.subOne', many: 'home.sent.sub' })}
              testId="task-sent"
            />
            <TaskCard href="/dues" icon="rupee" title={t('task.due.title')} sub={dueSub} testId="task-due" />
            <div className="task task--voice">
              <span className="task__icon" aria-hidden="true">
                <Icon name="mic" size={26} />
              </span>
              <span className="task__text">
                <span className="task__title">{t('task.voice.title')}</span>
                <span className="task__sub">{t('task.voice.sub')}</span>
                <VoiceButton />
              </span>
            </div>
            <TaskCard href="/ask" icon="ask" title={t('task.ask.title')} sub={t('task.ask.sub')} testId="task-ask" />
          </div>

          <h2 className="section-label">{t('task.more')}</h2>
          <div className="more">
            <Link href="/bills/help" className="more__item">
              <Icon name="help" size={20} />
              <span>{t('help.entry')}</span>
            </Link>
            <Link href="/customers" className="more__item">
              <Icon name="upload" size={20} />
              <span>{t('task.upload')}</span>
            </Link>
            {gstTabVisible(business) && (
              <Link href="/gst" className="more__item">
                <Icon name="gst" size={20} />
                <span>{t('task.gst')}</span>
              </Link>
            )}
          </div>
        </section>

        <aside className="card people" aria-labelledby="people-heading">
          <h2 id="people-heading" className="card__title">{t('people.title')}</h2>
          <CustomerPicker customers={people} mode="open" limit={8} allHref="/customers" />
        </aside>
      </div>
    </main>
  );
}
