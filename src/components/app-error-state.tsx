"use client";

import {
  ArrowClockwiseIcon,
  HouseIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";

import styles from "./app-error-state.module.css";

type AppErrorStateProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  reference: string;
  retry?: () => void;
}>;

export function AppErrorState({
  eyebrow,
  title,
  description,
  reference,
  retry,
}: AppErrorStateProps) {
  return (
    <main className={styles.page} aria-labelledby="error-state-title">
      <section className={styles.card}>
        <span className={styles.icon} aria-hidden="true">
          <WarningCircleIcon size={27} weight="duotone" />
        </span>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title} id="error-state-title">
          {title}
        </h1>
        <p className={styles.description}>{description}</p>
        <div className={styles.actions}>
          {retry ? (
            <button className={styles.primaryAction} type="button" onClick={retry}>
              <ArrowClockwiseIcon size={18} aria-hidden="true" />
              다시 시도하기
            </button>
          ) : null}
          <Link
            className={retry ? styles.secondaryAction : styles.primaryAction}
            href="/"
          >
            <HouseIcon size={18} aria-hidden="true" />
            종목 화면으로 돌아가기
          </Link>
        </div>
        <p className={styles.reference}>{reference}</p>
      </section>
    </main>
  );
}

export { styles as appErrorStateStyles };
