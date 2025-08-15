import { UseProofOfLifeOptions } from "./useProofOfLife";
export type ProofOfLifeProps = UseProofOfLifeOptions & {
    onResult?: (passed: boolean) => void;
    onError?: (err: string) => void;
    debug?: boolean;
};
export declare function ProofOfLife(props: ProofOfLifeProps): import("react/jsx-runtime").JSX.Element;
