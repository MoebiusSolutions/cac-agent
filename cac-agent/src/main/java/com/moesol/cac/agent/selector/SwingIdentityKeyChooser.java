package com.moesol.cac.agent.selector;

import java.awt.AWTException;
import java.awt.AWTKeyStroke;
import java.awt.Component;
import java.awt.Image;
import java.awt.KeyboardFocusManager;
import java.awt.SystemTray;
import java.awt.TrayIcon;
import java.awt.Window;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.lang.reflect.InvocationTargetException;
import java.net.URL;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.prefs.BackingStoreException;
import java.util.prefs.Preferences;

import javax.swing.AbstractAction;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.KeyStroke;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;

public class SwingIdentityKeyChooser implements IdentityKeyChooser {
	private static final String TITLE = "CAC Agent";
	private final IdentityKeyListProvider provider;
	private String applicationName;
	private Component parentComponent;
	private JFrame defaultParent;
	private Timer maybeHideDefault = new Timer(1000, e -> hideDefault());
	private IdentityKeyCertFormatter formatter;
	private Timer maybeShowBusy = new Timer(1000, e -> showBusyNow());
	private JDialog busy;
	private String busyMessage = "Busy";
	private boolean reportedSystemTrayUnsupported = false;
	
	public SwingIdentityKeyChooser(IdentityKeyListProvider provider) {
		this.provider = provider;
		this.formatter = DefaultCertFormatter.INSTANCE;
		maybeHideDefault.start();
	}
	
	@Override
	public void setApplicationName(String applicationName) {
		this.applicationName = applicationName;
	}

	@Override
	public void setParentComponent(Component parentComponent) {
		this.parentComponent = parentComponent;
	}

	@Override
	public void setCertFormatter(IdentityKeyCertFormatter formatter) {
		this.formatter = formatter;
	}

	@Override
	public void showNoIdentitiesFound(final String remoteHost) {
		laterWithJFrame(frame -> {
			String title = makeTitle("No Identities Found");
			String message = "No certificates were found to authenticate to "
				+ (remoteHost == null ? "the server." : remoteHost);
			JOptionPane.showMessageDialog(frame, message, title, JOptionPane.WARNING_MESSAGE);
			addTrayNotification(message, TrayIcon.MessageType.WARNING);
		});
	}

	@Override
	public String chooseFromAliases(final String remoteHost, final String[] aliases) throws InvocationTargetException, InterruptedException {
		return invokeAndWait(() -> {
			return pickOnSwingThread(remoteHost, aliases);
		});
	}
	
	@Override
	public void reportException(final Exception e) {
		laterWithJFrame(frame -> {
			String msg = e.getLocalizedMessage();
			JOptionPane.showMessageDialog(frame, msg, makeTitle("Failed"), JOptionPane.ERROR_MESSAGE);
			addTrayNotification(msg, TrayIcon.MessageType.ERROR);
		});
	}
	
	@Override
	public void showBusy(final String message) {
		SwingUtilities.invokeLater(() -> {
			System.out.printf("%s: %s, %s%n", makeTitle(TITLE), message, SwingUtilities.isEventDispatchThread());
			busyMessage = message;
			maybeShowBusy.setInitialDelay(1000); // Show after one second
			maybeShowBusy.setRepeats(false);
			maybeShowBusy.start();
		});
	}
	
	public void showBusyNow() {
		laterWithJFrame(frame -> {
			JOptionPane pane = new JOptionPane(busyMessage, JOptionPane.INFORMATION_MESSAGE);
			busy = pane.createDialog(frame, makeTitle(TITLE));
			setWindowIcon(busy);
			addTrayNotification(busyMessage, TrayIcon.MessageType.INFO);
			busy.setModal(false);
			busy.setVisible(true);
		});
	}

	@Override
	public void hideBusy() {
		SwingUtilities.invokeLater(() -> {
			maybeShowBusy.stop();
			if (busy == null) { return; }
			busy.setVisible(false);
			busy.dispose();
			busy = null;
		});
	}

	@Override
	public char[] promptForPin(String title, String prompt) {
		return invokeAndWait(() -> {
			return promptForPinOnSwingThread(title, prompt);
		});
	}

	private char[] promptForPinOnSwingThread(String title, String prompt) {
		JLabel label = new JLabel(prompt);
		final JPasswordField pass = new JPasswordField(10);

		JPanel panel = new JPanel();
		panel.add(label);
		panel.add(pass);
		
		final JOptionPane pane = new JOptionPane();
		pane.setMessage(panel);
		pane.setMessageType(JOptionPane.QUESTION_MESSAGE);
		pane.setOptionType(JOptionPane.OK_CANCEL_OPTION);
		JDialog dialog = pane.createDialog(getParent(), title);
		setWindowIcon(dialog);
		addTrayNotification("PIN Required", TrayIcon.MessageType.INFO);

		dialog.addWindowFocusListener(new WindowAdapter() {
		    public void windowGainedFocus(WindowEvent e) {
		    	pass.requestFocusInWindow();
		    }
		});
		pass.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				pane.setValue(0);
			}
		});
		dialog.setVisible(true);
		Object result = pane.getValue();
		dialog.dispose();
		
		if (Integer.valueOf(0).equals(result)) {
			return pass.getPassword();
		}
		return null;
	}

	private String pickOnSwingThread(String remoteHost, String[] aliases) {
		Preferences prefs = Preferences.userNodeForPackage(getClass());
		String choosenAlias = prefs.get("choosenAlias", "");

		final JOptionPane pane = new JOptionPane();
		JPanel panel = new JPanel();
		panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
		if (remoteHost != null) {
			panel.add(new JLabel("Select a certificate to authenticate yourself to " + remoteHost));
			panel.add(Box.createVerticalStrut(10));
		}

		JButton preChoosen = null;
		List<JButton> buttons = new ArrayList<JButton>();
		X509Certificate[] certs = provider.makeCertList(aliases);
		for (int i = 0; i < aliases.length; i++) {
			final String alias = aliases[i];
			final X509Certificate cert = certs[i];
			String html = formatter.asHtml(alias, cert);
			JButton jb = new JButton(html);
			jb.setHorizontalAlignment(SwingConstants.LEFT);
			jb.addActionListener(new ActionListener() {
				@Override
				public void actionPerformed(ActionEvent e) {
					pane.setValue(alias);
				}
			});
			panel.add(jb);
			buttons.add(jb);

			if (choosenAlias.equals(alias)) {
				preChoosen = jb;
			}
		}

		pane.setMessage(panel);
		String cancel = "Cancel";
		pane.setOptions(new Object[] { cancel });

		final JDialog dialog = pane.createDialog(getParent(), makeTitle("Select Identity"));
		setWindowIcon(dialog);
		addTrayNotification("Select Identify", TrayIcon.MessageType.INFO);
		bindArrowKeys(dialog);
		panel.getInputMap(JComponent.WHEN_ANCESTOR_OF_FOCUSED_COMPONENT).put(KeyStroke.getKeyStroke("ENTER"), "selectKey");
		panel.getActionMap().put("selectKey", new AbstractAction() {
			@Override
			public void actionPerformed(ActionEvent e) {
				if (dialog.getFocusOwner() instanceof JButton) {
					JButton jb = (JButton) dialog.getFocusOwner();
					jb.doClick();
				}
			}
		});
		if (preChoosen != null) {
			preChoosen.requestFocusInWindow();
		}
		
		dialog.setVisible(true);
		Object result = pane.getValue();
		dialog.dispose();

		if (result instanceof String && result != cancel) {
			prefs.put("choosenAlias", (String) result);
			try {
				prefs.flush();
			} catch (BackingStoreException e1) {
				e1.printStackTrace();
			}
			return (String) result;
		}
		return null;
	}

	/**
	 * Invoke on swing thread and wait for result.
	 * @param <T>
	 * @param supplier
	 * @return value returned from supplier
	 */
	private <T> T invokeAndWait(Supplier<T> supplier) {
		// Do not need the atomic part, but convenient to hold the result and set it from swing thread.
		AtomicReference<T> result = new AtomicReference<>();
		try {
			SwingUtilities.invokeAndWait(() -> {
				result.set(supplier.get());
			});
			return result.get();
		} catch (InvocationTargetException | InterruptedException e) {
			throw new RuntimeException(e);
		}
	}

	private void bindArrowKeys(JDialog dialog) {
		{
			Set<AWTKeyStroke> forwardKeys = dialog.getFocusTraversalKeys(KeyboardFocusManager.FORWARD_TRAVERSAL_KEYS);
			Set<AWTKeyStroke> newForwardKeys = new HashSet<>(forwardKeys);
			newForwardKeys.add(KeyStroke.getKeyStroke("DOWN"));
			newForwardKeys.add(KeyStroke.getKeyStroke("RIGHT"));
			dialog.setFocusTraversalKeys(KeyboardFocusManager.FORWARD_TRAVERSAL_KEYS, newForwardKeys);
		}

		{
			Set<AWTKeyStroke> backwardKeys = dialog.getFocusTraversalKeys(KeyboardFocusManager.BACKWARD_TRAVERSAL_KEYS);
			Set<AWTKeyStroke> newBackwardKeys = new HashSet<>(backwardKeys);
			newBackwardKeys.add(KeyStroke.getKeyStroke("UP"));
			newBackwardKeys.add(KeyStroke.getKeyStroke("LEFT"));
			dialog.setFocusTraversalKeys(KeyboardFocusManager.BACKWARD_TRAVERSAL_KEYS, newBackwardKeys);
		}
	}

	@Override
	public void promptForCardInsertion(String title, String error) {
		invokeAndWait(() -> {
			String msg = error + "\n\nInsert Smart Card";
		
			Object stringArray[] = { "OK", "Exit" };
			int r = JOptionPane.showOptionDialog(getParent(), msg, title, 
					JOptionPane.YES_NO_OPTION, 
					JOptionPane.QUESTION_MESSAGE, null, stringArray, stringArray[0]);
			addTrayNotification(msg, TrayIcon.MessageType.INFO);
			switch (r) {
			case JOptionPane.OK_OPTION:
				break;
			case JOptionPane.NO_OPTION:
				System.exit(0);
				break;
			default:
				break;	
			}
			return r;
		});
	}

	protected Component getParent() {
		if (parentComponent != null) {
			return parentComponent;
		}
		if (defaultParent != null) {
			defaultParent.setVisible(true);
			return defaultParent;
		}

		JFrame frame = new JFrame(TITLE);
		frame.setUndecorated(true);
		frame.setVisible(true);
		frame.setLocationRelativeTo(null);

		defaultParent = frame;
		return frame;
	}
	/**
	 * Maybe hide and dispose of defaultParent.
	 * Skip if defaultParent is not in use.
	 * Otherwise, when we detect all of our dialogs are closed,
	 * we can hide and dispose of the defaultParent.
	 */
	private void hideDefault() {
		if (defaultParent == null) {
			return;
		}
		int visible = 0;
		for (Window w : defaultParent.getOwnedWindows()) {
			if (w == defaultParent) {
				continue;
			}
			if (w.isShowing()) {
				visible++;
			}
		}
		if (visible == 0) {
			System.out.println("Hiding/disposing default");
			defaultParent.setVisible(false);
			defaultParent.dispose();
			defaultParent = null;
		}
	}

	protected String makeTitle(final String baseTitle) {
		if (applicationName == null) {
			return baseTitle;
		} else {
			return baseTitle + " - " + applicationName;
		}
	}

	protected void setWindowIcon(final Window w) {
		Window parentWindow = null;
		if (parentComponent instanceof Window) {
			parentWindow = (Window) parentComponent;
		} else if (parentComponent != null) {
			parentWindow = SwingUtilities.getWindowAncestor(parentComponent);
		}

		if (parentWindow != null) {
			List<Image> iconImages = parentWindow.getIconImages();
			if (iconImages != null && !iconImages.isEmpty()) {
				w.setIconImages(iconImages);
			}
		}
	}

	private void laterWithJFrame(Consumer<Component> consumer) {
		SwingUtilities.invokeLater(() -> {
			consumer.accept(getParent());
		});
	}

	private void addTrayNotification(String msg, TrayIcon.MessageType type) {
		if (!SystemTray.isSupported()) {
			if (reportedSystemTrayUnsupported) {
				return;
			}
			System.out.println("SystemTray is not supported");
			reportedSystemTrayUnsupported = true;
			return;
		}
		Image image = createImage("/smart-card-icon.png", TITLE);
		if (image == null) {
			System.err.println("createImage failed");
			return;
		}
		SystemTray tray = SystemTray.getSystemTray();
		TrayIcon[] icons = tray.getTrayIcons();
		TrayIcon trayIcon = null;
		if (icons.length == 0) {
			try {
				trayIcon = new TrayIcon(image, applicationName);
				trayIcon.setImageAutoSize(true);
				trayIcon.setToolTip(TITLE);
				trayIcon.addMouseListener(new MouseAdapter() {
					public void mouseClicked(MouseEvent e) {
						if (defaultParent == null) {
							return;
						}
						defaultParent.toFront();
						defaultParent.requestFocus();
					}
				});
				tray.add(trayIcon);
			} catch (AWTException e) {
				e.printStackTrace(System.err);
			}
		} else {
			trayIcon = icons[0];
		}
		if (trayIcon != null) {
			trayIcon.displayMessage(TITLE, msg, type);
		}
	}
	protected static Image createImage(String path, String description) {
        URL imageURL = SwingIdentityKeyChooser.class.getResource(path);
         
        if (imageURL == null) {
            System.err.println("Resource not found: " + path);
            return null;
        } else {
            return (new ImageIcon(imageURL, description)).getImage();
        }
    }

}
