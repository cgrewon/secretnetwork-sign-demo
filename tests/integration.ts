import axios from "axios";
import { Wallet, SecretNetworkClient, fromUtf8 } from "secretjs";
import fs from "fs";
import assert from "assert";

require("dotenv").config();

const MNEMONIC = process.env.MNEMONICS;

const CODE_ID = undefined;
// Returns a client with which we can interact with secret network
const initializeClient = async (endpoint: string, chainId: string) => {
  const wallet = new Wallet(MNEMONIC); // Use default constructor of wallet to generate random mnemonic.
  const accAddress = wallet.address;
  console.log("accAddress of wallet: ", accAddress);

  const client = await SecretNetworkClient.create({
    // Create a client to interact with the network
    grpcWebUrl: endpoint,
    chainId: chainId,
    wallet: wallet,
    walletAddress: accAddress,
  });

  console.log(`Initialized client with wallet address: ${accAddress}`);
  return client;
};

// Stores and instantiaties a new contract in our network
const initializeContract = async (
  client: SecretNetworkClient,
  contractPath: string,
  contractCode?: number
) => {
  let codeId;
  if (contractCode && contractCode > 0) {
    codeId = contractCode;
  } else {
    const wasmCode = fs.readFileSync(contractPath);
    console.log("Uploading contract");

    const uploadReceipt = await client.tx.compute.storeCode(
      {
        wasmByteCode: wasmCode,
        sender: client.address,
        source: "",
        builder: "",
      },
      {
        gasLimit: 5000000,
      }
    );

    if (uploadReceipt.code !== 0) {
      console.log(
        `Failed to get code id: ${JSON.stringify(uploadReceipt.rawLog)}`
      );
      throw new Error(`Failed to upload contract`);
    }

    const codeIdKv = uploadReceipt.jsonLog![0].events[0].attributes.find(
      (a: any) => {
        return a.key === "code_id";
      }
    );

    codeId = Number(codeIdKv!.value);
  }

  // const codeId = 11178;

  console.log("Contract codeId: ", codeId);

  const contractCodeHash = await client.query.compute.codeHash(codeId);
  console.log(`Contract hash: ${contractCodeHash}`);

  const contract = await client.tx.compute.instantiateContract(
    {
      sender: client.address,
      codeId,
      initMsg: { count: 4 }, // Initialize our counter to start from 4. This message will trigger our Init function
      codeHash: contractCodeHash,
      label: "My contract" + Math.ceil(Math.random() * 10000), // The label should be unique for every contract, add random string in order to maintain uniqueness
    },
    {
      gasLimit: 1000000,
    }
  );

  if (contract.code !== 0) {
    throw new Error(
      `Failed to instantiate the contract with the following error ${contract.rawLog}`
    );
  }

  const contractAddress = contract.arrayLog!.find(
    (log) => log.type === "message" && log.key === "contract_address"
  )!.value;

  console.log(`Contract address: ${contractAddress}`);

  var contractInfo: [string, string] = [contractCodeHash, contractAddress];
  return contractInfo;
};

const getFromFaucet = async (address: string) => {
  await axios.get(`http://localhost:5000/faucet?address=${address}`);
};

async function getScrtBalance(userCli: SecretNetworkClient): Promise<string> {
  let balanceResponse = await userCli.query.bank.balance({
    address: userCli.address,
    denom: "uscrt",
  });
  return balanceResponse.balance!.amount;
}

async function fillUpFromFaucet(
  client: SecretNetworkClient,
  targetBalance: Number
) {
  let balance = await getScrtBalance(client);
  while (Number(balance) < targetBalance) {
    try {
      await getFromFaucet(client.address);
    } catch (e) {
      console.error(`failed to get tokens from faucet: ${e}`);
    }
    balance = await getScrtBalance(client);
  }
  console.error(`got tokens from faucet: ${balance}`);
}

// Initialization procedure
async function initializeAndUploadContract() {
  // let endpoint = "http://localhost:9091";
  // let chainId = "secretdev-1";

  // let endpoint = "https://rpc.pulsar.scrttestnet.com";
  // let endpoint = "https://rpc.testnet.secretsaturn.net";
  let endpoint = "https://grpc.pulsar.scrttestnet.com";
  let chainId = "pulsar-2";

  const client = await initializeClient(endpoint, chainId);

  // await fillUpFromFaucet(client, 100_000_000);

  console.log("Begin initialize contract.");

  const [contractHash, contractAddress] = await initializeContract(
    client,
    "../contract.wasm",
    CODE_ID
  );
  console.log("End initialize contract.");

  var clientInfo: [SecretNetworkClient, string, string] = [
    client,
    contractHash,
    contractAddress,
  ];
  return clientInfo;
}

async function queryCount(
  client: SecretNetworkClient,
  contractHash: string,
  contractAddress: string
): Promise<number> {
  type CountResponse = { count: number };

  const countResponse = (await client.query.compute.queryContract({
    contractAddress: contractAddress,
    codeHash: contractHash,
    query: { get_count: {} },
  })) as CountResponse;

  if ('err"' in countResponse) {
    throw new Error(
      `Query failed with the following err: ${JSON.stringify(countResponse)}`
    );
  }

  return countResponse.count;
}

async function queryValidate(
  client: SecretNetworkClient,
  contractHash: string,
  contractAddress: string
): Promise<boolean> {
  type VerifyResponse = { verified: boolean };

  const permit = {
    "signature": "SSxw2pj/PPqywe9GIGJAHB9WHCZNRUABD9EAvoAp3WkZfU4pYmKLNyZcdYRdl3ivRx36vypbGLiswRqSlZ6HZQ==",
    "pubkey": "Au735erpkFh9WKOBanA6ul4oQeB2gjh4AI4j7e1DGCW1",
    "signed": {
        "chain_id": "pulsar-2",
        "account_number": "0",
        "sequence": "0",
        "fee": {
            "gas": "1",
            "amount": [
                {
                    "denom": "uscrt",
                    "amount": "0"
                }
            ]
        },
        "msgs": [
            {
                "type": "veirfy-memo",
                "value": "This is a signature request. Accepting this request will allow us to verify ownership of your wallet. "
            }
        ],
        "memo": "Created by keplr"
    }
}

  const verifyResponse = (await client.query.compute.queryContract({
    contractAddress: contractAddress,
    codeHash: contractHash,
    query: { validate: { permit } },
  })) as VerifyResponse;

  if ('err"' in verifyResponse) {
    throw new Error(
      `Query Verify failed with the following err: ${JSON.stringify(
        verifyResponse
      )}`
    );
  }

  return verifyResponse.verified;
}

async function incrementTx(
  client: SecretNetworkClient,
  contractHash: string,
  contractAddess: string
) {
  const tx = await client.tx.compute.executeContract(
    {
      sender: client.address,
      contractAddress: contractAddess,
      codeHash: contractHash,
      msg: {
        increment: {},
      },
      sentFunds: [],
    },
    {
      gasLimit: 200000,
    }
  );

  //let parsedTransactionData = JSON.parse(fromUtf8(tx.data[0])); // In our case we don't really need to access transaction data
  console.log(`Increment TX used ${tx.gasUsed} gas`);
}

async function resetTx(
  client: SecretNetworkClient,
  contractHash: string,
  contractAddess: string
) {
  const tx = await client.tx.compute.executeContract(
    {
      sender: client.address,
      contractAddress: contractAddess,
      codeHash: contractHash,
      msg: {
        reser: { count: 0 },
      },
      sentFunds: [],
    },
    {
      gasLimit: 200000,
    }
  );

  console.log(`Reset TX used ${tx.gasUsed} gas`);
}

// The following functions are only some examples of how to write integration tests, there are many tests that we might want to write here.
async function test_count_on_intialization(
  client: SecretNetworkClient,
  contractHash: string,
  contractAddress: string
) {
  const onInitializationCounter: number = await queryCount(
    client,
    contractHash,
    contractAddress
  );
  console.log("onInitializationCounter; ", onInitializationCounter);
  assert(
    onInitializationCounter === 4,
    `The counter on initialization expected to be 4 instead of ${onInitializationCounter}`
  );
}
async function test_verified(
  client: SecretNetworkClient,
  contractHash: string,
  contractAddress: string
) {
  const verified: boolean = await queryValidate(
    client,
    contractHash,
    contractAddress
  );
  console.log("verified; ", verified);
  assert(
    verified === true,
    `The verified on initialization expected to be true of ${verified}`
  );
}

async function test_increment_stress(
  client: SecretNetworkClient,
  contractHash: string,
  contractAddress: string
) {
  const onStartCounter: number = await queryCount(
    client,
    contractHash,
    contractAddress
  );

  let stressLoad: number = 1;
  for (let i = 0; i < stressLoad; ++i) {
    await incrementTx(client, contractHash, contractAddress);
  }

  const afterStressCounter: number = await queryCount(
    client,
    contractHash,
    contractAddress
  );
  assert(
    afterStressCounter - onStartCounter === stressLoad,
    `After running stress test the counter expected to be ${
      onStartCounter + 10
    } instead of ${afterStressCounter}`
  );
}

async function test_gas_limits() {
  // There is no accurate way to measue gas limits but it is actually very recommended to make sure that the gas that is used by a specific tx makes sense
}

async function runTestFunction(
  tester: (
    client: SecretNetworkClient,
    contractHash: string,
    contractAddress: string
  ) => void,
  client: SecretNetworkClient,
  contractHash: string,
  contractAddress: string
) {
  console.log(`Testing ${tester.name}`);
  await tester(client, contractHash, contractAddress);
  console.log(`[SUCCESS] ${tester.name}`);
}

(async () => {
  const [client, contractHash, contractAddress] =
    await initializeAndUploadContract();

  await runTestFunction(
    test_count_on_intialization,
    client,
    contractHash,
    contractAddress
  );
  await runTestFunction(test_verified, client, contractHash, contractAddress);
  // await runTestFunction(
  //   test_increment_stress,
  //   client,
  //   contractHash,
  //   contractAddress
  // );
  // await runTestFunction(test_gas_limits, client, contractHash, contractAddress);
})();
