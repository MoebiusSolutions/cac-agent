package com.moesol.cac.agent.selector;

import java.io.File;
import java.security.KeyStore;
import java.security.Provider;
import java.security.Security;

import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.SwingUtilities;

import com.moesol.url.CacHookingAgent;

public class Pkcs11SelectorKeyManager extends SwingSelectorKeyManager {

	private Provider provider;
	private JDialog busy;

	@Override
	protected KeyStore accessKeyStore() throws Exception {
		setUpProvider();
		
		char[] pin = promptForPin();
		if (pin == null) {
			System.out.println("pin entry cancelled");
			return null; 
		}
		
		showBusy("Accessing CAC...");
		try {
			KeyStore ks = KeyStore.getInstance("PKCS11", provider);
			ks.load(null, pin);
			return ks;
		} finally {
			hideBusy();
		}
	}
	
	private void setUpProvider() {
		showBusy("Initializing PKCS#11...");
		try {
			System.out.println("setUp pkcs11 start");
			String home = System.getProperty("user.home");
			String configName = home + "/" + CacHookingAgent.CAC_AGENT_DIR + "/pkcs11.cfg";
			File configFile = new File(configName);
			if (configFile.exists()) {
				provider = new sun.security.pkcs11.SunPKCS11(configName);
				Security.addProvider(provider);	
			} else {
				String message = "Not found: " + configName;
				String title = "PKCS#11 Configuration Not Loaded";
				JOptionPane.showMessageDialog(null, message, title, JOptionPane.WARNING_MESSAGE);
			}
		} finally {
			hideBusy();
		}
	}

	private void showBusy(final String message) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane pane = new JOptionPane(message, JOptionPane.INFORMATION_MESSAGE);
				busy = pane.createDialog("CAC");
				busy.setModal(false);
				busy.setVisible(true);
			}
		});
	}

	private void hideBusy() {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				busy.setVisible(false);
				busy.dispose();
				busy = null;
			}
		});
	}

	private char[] promptForPin() {
		JPanel panel = new JPanel();
		JLabel label = new JLabel("Enter a PIN:");
		JPasswordField pass = new JPasswordField(10);
		panel.add(label);
		panel.add(pass);
		String[] options = new String[] { "OK", "Cancel" };
		int option = JOptionPane.showOptionDialog(null, panel, "CAC",
				JOptionPane.NO_OPTION, JOptionPane.PLAIN_MESSAGE, null,
				options, options[0]);
		if (option == 0) {
			// pressing OK button
			return pass.getPassword();
		}
		return null;
	}

	public static void main(String[] args) {
		CacHookingAgent.DEBUG = true;
		System.out.println("chose: "
				+ new Pkcs11SelectorKeyManager().chooseClientAlias(null, null, null));
	}

}
