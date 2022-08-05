use core::fmt;
use std::fmt::format;

use crate::msg::{CheckSignQuery, InitMsg, QueryMsg, VerifyResponse};
use crate::state::{config, config_read, State};

use bech32::{ToBase32, Variant};
use cosmwasm_std::{
    to_binary, Api, Binary, Env, Extern, HandleResponse, HumanAddr, InitResponse, Querier,
    StdError, StdResult, Storage,
};
use secret_toolkit::crypto::sha_256;
// use secret_toolkit::permit::funcs::validate;
use secret_toolkit::permit::pubkey_to_account;

pub fn init<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
    msg: InitMsg,
) -> StdResult<InitResponse> {
    let state = State {
        count: msg.count,
        owner: deps.api.canonical_address(&env.message.sender)?,
    };

    config(&mut deps.storage).save(&state)?;

    Ok(InitResponse::default())
}

pub fn query<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>,
    msg: QueryMsg,
) -> StdResult<Binary> {
    match msg {
        QueryMsg::Validate { permit } => to_binary(&verify_signer(deps, permit)?),
    }
}

pub fn pubkey_str_humanaddr(pubkey: &str) -> HumanAddr {
    let pubkey_binary = Binary::from_base64(pubkey).unwrap();

    let base32_addr = pubkey_to_account(&pubkey_binary).0.as_slice().to_base32();
    let account: String = bech32::encode(&"secret", &base32_addr, Variant::Bech32).unwrap();

    HumanAddr::from(account.as_str())
}

pub fn verify_signer<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>,
    permit: CheckSignQuery,
) -> StdResult<VerifyResponse> {
    
    let account: String = pubkey_str_humanaddr(permit.pubkey.as_str()).to_string();

    let signed_bytes = to_binary(&permit.signed)?;
    let signed_bytes_hash = sha_256(signed_bytes.as_slice());

    let sig_binary = to_binary(&permit.signature).map_err(|err| {
        StdError::generic_err(format!("Error at sig_binary : {}", err.to_string()))
    })?;

    let pubkey_binary = to_binary(&permit.pubkey).map_err(|err| {
        StdError::generic_err(format!("Error at pubkey_binary: {}", err.to_string()))
    })?;

    let verified = deps
        .api
        .secp256k1_verify(&signed_bytes_hash, &sig_binary.0, &pubkey_binary.0)
        .map_err(|err| StdError::generic_err(format!("Error at verify {}", err.to_string())))?;

    Ok(VerifyResponse {
        verified,
        derived_addr: account,
    })

}

#[cfg(test)]
mod tests {
    use crate::msg::{AmountInFeeInSigned, FeeInSigned, SignMsg, SignedData};

    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env};
    use cosmwasm_std::{coins, from_binary, StdError};
    use std::println as info; // Workaround to use prinltn! for logs.

    #[test]
    fn proper_initialization() {
        info!(">>>>>>>>>>>.. Debug:: proper_initialization");

        let mut deps = mock_dependencies(20, &[]);

        let msg = InitMsg { count: 17 };
        let env = mock_env("creator", &coins(1000, "earth"));

        info!(">>>>>>>>>>>.. Debug:: {:?}, {:?}", msg, env);

        // we can just call .unwrap() to assert this was a success
        let res = init(&mut deps, env, msg).unwrap();
        assert_eq!(0, res.messages.len());
    }

    #[test]
    fn verify_test() {
        info!(">>>>>>>>>>>.. Debug:: verify_test");

        let mut deps = mock_dependencies(20, &[]);

        let msg = InitMsg { count: 17 };
        let env = mock_env("creator", &coins(2, "token"));
        let _res = init(&mut deps, env, msg).unwrap();

        let res_validate = query(
            &deps,
            QueryMsg::Validate {
                permit: CheckSignQuery {
                    signature: String::from("SSxw2pj/PPqywe9GIGJAHB9WHCZNRUABD9EAvoAp3WkZfU4pYmKLNyZcdYRdl3ivRx36vypbGLiswRqSlZ6HZQ=="),
                    pubkey: String::from("Au735erpkFh9WKOBanA6ul4oQeB2gjh4AI4j7e1DGCW1"),
                    signed: SignedData {
                        chain_id: String::from("pulsar-2"),
                        account_number:  "0".to_string(),
                        sequence: "0".to_string(),
                        fee: FeeInSigned { gas: "1".to_string(), amount: AmountInFeeInSigned { denom: String::from("uscrt") , amount: "0".to_string() } },
                        msgs: vec![SignMsg{
                            r#type:String::from("veirfy-memo"),
                            value: String::from("This is a signature request. Accepting this request will allow us to verify ownership of your wallet. ")
                        }],
                        memo: String::from("Created by keplr"),
                    },
                },
            },
        )
        .map_err(|err|StdError::generic_err(format!("Error at query for test:: {}", err.to_string())))
        .unwrap();

        let verify_result: VerifyResponse = from_binary(&res_validate).unwrap();
        info!(">>>>>>>>> verify_result :: {:?}", verify_result);
        assert_eq!(true, verify_result.verified);
    }
}
