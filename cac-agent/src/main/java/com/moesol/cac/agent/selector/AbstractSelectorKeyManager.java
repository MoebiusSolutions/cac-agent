package com.moesol.cac.agent.selector;

import java.net.Socket;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.ProviderException;
import java.security.cert.Certificate;
import java.security.cert.CertificateParsingException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.X509ExtendedKeyManager;
import javax.net.ssl.X509KeyManager;
import javax.security.auth.x500.X500Principal;

import com.moesol.cac.agent.CacHookingAgent;
import com.moesol.cac.agent.Config;

/**
 * When installed as the default key manager, this class prompts the user as
 * needed to choose a key. The default chooser uses Swing, but a Tty base
 * chooser can be set as a property.
 * <p>
 * Note that this key manager cannot be used if you are creating an SSL/TLS
 * server because it throws UnsupportedOperationException when asked
 * to choose a server KeyManager.
 * <p>
 * @author hastings
 */
public abstract class AbstractSelectorKeyManager extends X509ExtendedKeyManager	
	implements X509KeyManager, IdentityKeyListProvider 
{
	private static final String KEY_USAGE_OID_CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
	private static final String KEY_USAGE_OID_ANY = "2.5.29.37.0";

	private Map<String, String> lastChosenAlias = new HashMap();
	protected final Object keyStoreLock = new Object();
	private KeyStore keyStore;
	protected IdentityKeyChooser chooser = new SwingIdentityKeyChooser(this);
	protected boolean checkCertIssuer = true;
	protected boolean checkKeyUsage = true;

	public AbstractSelectorKeyManager() {
	}
	public IdentityKeyChooser getIdentityKeyChooser() {
		return chooser;
	}
	public void setIdentityKeyChooser(IdentityKeyChooser chooser) {
		this.chooser = chooser;
	}
	public void setCheckCertIssuer(boolean checkCertIssuer) {
		this.checkCertIssuer = checkCertIssuer;
	}
	public void setCheckKeyUsage(boolean checkKeyUsage) {
		this.checkKeyUsage = checkKeyUsage;
	}

	/**
	 * Injects this manager into the SSLContext.
	 * @param config 
	 * 
	 * @throws NoSuchAlgorithmException
	 * @throws KeyManagementException
	 */
	public static AbstractSelectorKeyManager configureSwingKeyManagerAsDefault(Config config) throws NoSuchAlgorithmException, KeyManagementException {
		return configureSwingKeyManagerAsDefault(config, null);
	}

	/**
	 * Injects this manager into the SSLContext.
	 * @param config configuration parameters for initialization
	 * @param applicationName the name of the enclosing application
	 * 
	 * @throws NoSuchAlgorithmException
	 * @throws KeyManagementException
	 */
	public static AbstractSelectorKeyManager configureSwingKeyManagerAsDefault(Config config, String applicationName) throws NoSuchAlgorithmException, KeyManagementException {
		if (CacHookingAgent.DEBUG) {
			System.out.println("Context: " + CacHookingAgent.CONTEXT);
		}
		KeyManager[] kmgrs = makeKeyManagers(config);
		SSLContext sslContext = SSLContext.getInstance(CacHookingAgent.CONTEXT);
		sslContext.init(kmgrs, null, new java.security.SecureRandom());
		SSLContext.setDefault(sslContext);

		HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.getSocketFactory());

		AbstractSelectorKeyManager result = (AbstractSelectorKeyManager) kmgrs[0];
		result.getIdentityKeyChooser().setApplicationName(applicationName);
		return result;
	}

	public static KeyManager[] makeKeyManagers(Config config) {
		String os = System.getProperty("os.name").toLowerCase();
		AbstractSelectorKeyManager keyManager;
		if (os.startsWith("win")) {
			System.out.println("Windows key manager");
			keyManager =  new WindowsSelectorKeyManager();
		} else {
			System.out.println("Linux key manager");
			keyManager = new Pkcs11SelectorKeyManager();
		}
		keyManager.setCheckCertIssuer(config.isCheckCertIssuer());
		keyManager.setCheckKeyUsage(config.isCheckKeyUsage());
		if (config.isTty()) {
			keyManager.setIdentityKeyChooser(new TtyIdentityKeyChooser(keyManager));
		}
		return new KeyManager[] { keyManager };
	}

	public KeyStore getKeyStore() {
		synchronized (keyStoreLock) {
			if (keyStore != null) {
				return keyStore;
			}
			try {
				keyStore = accessKeyStore();
			} catch (Exception e) {
				reportAndConvert(e);
			}
			return keyStore;
		}
	}
	public void setKeyStore(KeyStore ks) {
		synchronized (keyStoreLock) {
			keyStore = ks;
		}
	}

	protected abstract KeyStore accessKeyStore() throws Exception;

	// NOTE: Overrides the non-abstract method in base class, tricky.
	@Override
	public String chooseEngineClientAlias(String[] keyType, Principal[] issuers, SSLEngine engine) {
		String peerKey = null;
		if (engine != null) {
			peerKey = engine.getPeerHost() + ":" + engine.getPeerPort();
		}
		return choosePeerClientAlias(keyType, issuers, peerKey);
	}
	@Override
	public String chooseClientAlias(String[] keyType, Principal[] issuers, Socket socket) {
		String peerKey = null;
		if (socket != null && socket.getInetAddress() != null) {
			peerKey = socket.getInetAddress().getHostName() + ":" + socket.getPort();
		}
		return choosePeerClientAlias(keyType, issuers, peerKey);
	}
	protected synchronized String choosePeerClientAlias(final String[] keyType, final Principal[] issuers, final String peerKey) {
		if (CacHookingAgent.DEBUG) {
			System.out.println("chooseClientAlias: ");
		}

		String choosenAlias = lastChosenAlias.get(peerKey);
		if (lastChosenAlias.containsKey(peerKey)) {
			if (CacHookingAgent.DEBUG) {
				System.out.println("cached chooseClientAlias: " + choosenAlias);
			}
			return choosenAlias;
		}

		try {
			choosenAlias = maybeUseDefaultCertificateName(issuers);
			if (choosenAlias != null) {
				return choosenAlias;
			}

			final String[] aliases = getClientAliases(null, issuers);
			if (aliases.length > 0) {
				// only prompt user for alias selection if choices exist
				choosenAlias = chooser.chooseFromAliases(peerKey, aliases);
			} else {
				chooser.showNoIdentitiesFound(peerKey);
			}
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
		if (CacHookingAgent.DEBUG) {
			System.out.println("chooseClientAlias: " + choosenAlias);
		}
		lastChosenAlias.put(peerKey, choosenAlias);
		return choosenAlias;
	}
	
	/**
	 * @param issuers
	 * @return null unless the default.cert.name should be used.
	 */
	private String maybeUseDefaultCertificateName(Principal[] issuers) {
		Config config = Config.loadFromUserHome();
		
		String defaultCertName = config.getDefaultCertificateName();
		if (defaultCertName == null) {
			return null;
		}
		defaultCertName = defaultCertName.trim();
		if (defaultCertName.isEmpty()) {
			return null;
		}
		List<String> alias = Arrays.asList(getClientAliases(null, issuers));
		if (!alias.contains(defaultCertName)) {
			System.err.println();
			System.err.println("Note: 'default.cert.name' does not exist, ignoring");
			System.err.println("       default.cert.name=" + defaultCertName);
			System.err.println();
			return null;
		}
		if (CacHookingAgent.DEBUG) {
			System.out.println("config chooseClientAlias: " + defaultCertName);
		}
		return defaultCertName;
	}

	@Override
	public X509Certificate[] makeCertList(String[] aliases) {
		X509Certificate[] result = new X509Certificate[aliases.length];
		if (keyStore == null) {
			return result;
		}

		for (int i = 0; i < aliases.length; i++) {
			final String alias = aliases[i];
			Certificate cert;
			try {
				cert = keyStore.getCertificate(alias);
				X509Certificate x509 = (X509Certificate) cert;
				result[i] = x509;

			} catch (ClassCastException | KeyStoreException e1) {
				// should not occur, since certs were retrieved/validated by getClientAliases
				result[i] = null;
			}
		}
		return result;
	}

	@Override
	public X509Certificate[] getCertificateChain(String alias) {
		try {
			return (X509Certificate[]) getKeyStore().getCertificateChain(alias);
		} catch (KeyStoreException e) {
			throw reportAndConvert(e);
		}
	}

	@Override
	public String[] getClientAliases(String keyType, Principal[] issuers) {
		if (CacHookingAgent.DEBUG) {
			System.out.println("getClientAliases: ");
		}
		try {
			KeyStore ks = getKeyStore();
			if (ks == null) {
				return new String[0];
			}
			Set<Principal> issuerSet = null;
			if (issuers != null && issuers.length > 0) {
				issuerSet = new HashSet<>(Arrays.asList(issuers));
			}
			ArrayList<String> asList = new ArrayList<String>();
			Enumeration<String> aliases = ks.aliases();
			while (aliases.hasMoreElements()) {
				// Ignore keyType filter to workaround bug JDK-8262186
				String alias = aliases.nextElement();
				if (ks.isKeyEntry(alias)) {
					Certificate[] chain = ks.getCertificateChain(alias);
					if (isX509Chain(chain)
							&& (!checkKeyUsage || keyUsageMatches(chain))
							&& (!checkCertIssuer || issuerMatches(chain, issuerSet))) {
						asList.add(alias);
					}
				}
			}
			return asList.toArray(new String[asList.size()]);
		} catch (KeyStoreException e) {
			throw reportAndConvert(e);
		}
	}
	private boolean isX509Chain(Certificate[] chain) {
		if (chain == null || chain.length == 0) {
			return false;
		} else {
			for (Certificate c : chain) {
				if (c instanceof X509Certificate == false) {
					return false;
				}
			}
			return true;
		}
	}
	private boolean keyUsageMatches(Certificate[] chain) {
		try {
			// if the extended key usage field is present, it must contain a client auth OID
			X509Certificate c = (X509Certificate) chain[0];
			List<String> extended = c.getExtendedKeyUsage();
			if (extended != null
					&& !extended.contains(KEY_USAGE_OID_CLIENT_AUTH)
					&& !extended.contains(KEY_USAGE_OID_ANY)) {
				return false;
			}

			// if the key usage field is present, it must contain algorithm-specific bits
			boolean[] usage = c.getKeyUsage();
			if (usage != null) {
				switch (c.getPublicKey().getAlgorithm()) {
				case "RSA":
				case "DSA":
				case "EC":
					// require digitalSignature bit
					if (usage.length < 1 || usage[0] == false) {
						return false;
					}
					break;
				case "DH":
					// require keyAgreement bit
					if (usage.length < 5 || usage[4] == false) {
						return false;
					}
					break;
				}
			}

			// certificate key usage passes checks
			return true;
		} catch (CertificateParsingException ce) {
			// key usage fields were unparseable
			return false;
		}
	}
	private boolean issuerMatches(Certificate[] chain, Set<Principal> issuerSet) {
		if (issuerSet == null) {
			return true;
		} else {
			for (Certificate c : chain) {
				X509Certificate x509 = (X509Certificate) c;
				X500Principal issuer = x509.getIssuerX500Principal();
				if (issuerSet.contains(issuer)) {
					return true;
				}
			}
			return false;
		}
	}

	@Override
	public PrivateKey getPrivateKey(String alias) {
		try {
			try {
				return (PrivateKey) getKeyStore().getKey(alias, null);
			} catch (ProviderException e) {
				// One time try to repair Token has been removed.
				synchronized (keyStoreLock) {
					keyStore = null;
				}
				return (PrivateKey) getKeyStore().getKey(alias, null);
			}
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
	}

	// NOTE: Overrides the non-abstract method in base class, tricky.
	@Override
	public String chooseEngineServerAlias(String keyType, Principal[] issuers, SSLEngine engine) {
		throw new UnsupportedOperationException("Client manager only");
	}
	@Override
	public String chooseServerAlias(String keyType, Principal[] issuers, Socket socket) {
		throw new UnsupportedOperationException("Client manager only");
	}

	@Override
	public String[] getServerAliases(String keyType, Principal[] issuers) {
		throw new UnsupportedOperationException("Client manager only");
	}

	public RuntimeException reportAndConvert(final Exception e) {
		chooser.reportException(e);
		return new RuntimeException(e);
	}
	
}