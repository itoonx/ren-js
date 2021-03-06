import React from "react";
import { Meta, Story } from "@storybook/react";
import { MultiwalletProvider, WalletPicker, WalletPickerProps } from "../src";
import { makeStyles } from "@material-ui/core/styles";
import { RenNetwork } from "@renproject/interfaces";

const meta: Meta<typeof WalletPicker> = {
  title: "Welcome",
  component: WalletPicker,
  parameters: {
    controls: { expanded: true },
  },
};

export default meta;

const Template: Story<any> = (args) => (
  <MultiwalletProvider>
    <WalletPicker {...args} />
  </MultiwalletProvider>
);

// By passing using the Args format for exported stories, you can control the props for a component for reuse in a test
// https://storybook.js.org/docs/react/workflows/unit-testing
export const Default = Template.bind({});

const defaultProps: WalletPickerProps<any, any> = {
  onClose: () => {
    console.debug("close");
  },
  chain: "ethereum",
  targetNetwork: RenNetwork.Testnet,
  config: {
    chains: {
      ethereum: [
        {
          info: ({ acknowledge, onClose }) => (
            <div>
              Are you sure you want to connect this wallet?{" "}
              <button onClick={acknowledge}>Yes</button>
              <button onClick={onClose}>No</button>
            </div>
          ),
          name: "metamask",
          logo: "https://avatars1.githubusercontent.com/u/11744586?s=60&v=4",
          connector: {} as any,
        },
      ],
    },
  },
};
Default.args = defaultProps;

export const Connecting = Template.bind({});

const connectingProps: WalletPickerProps<any, any> = {
  ...defaultProps,
  connecting: true,
  config: {
    chains: {
      ethereum: [],
    },
  },
};

Connecting.args = connectingProps;

export const CustomConnecting = Template.bind({});

const customConnectingProps: WalletPickerProps<any, any> = {
  ...defaultProps,
  connecting: true,
  config: {
    chains: {
      ethereum: [],
    },
  },
  ConnectingInfo: ({ chain }) => (
    <div>A custom connecting component for {chain}</div>
  ),
};

CustomConnecting.args = customConnectingProps;

export const CustomWalletButton = Template.bind({});

const customWalletButtonProps: WalletPickerProps<any, any> = {
  ...defaultProps,
  config: {
    chains: {
      ethereum: [
        {
          name: "metamask",
          logo: "https://avatars1.githubusercontent.com/u/11744586?s=60&v=4",
          connector: {} as any,
        },
      ],
    },
  },
  WalletEntryButton: ({ name }) => <button>A custom button for {name}</button>,
};

CustomWalletButton.args = customWalletButtonProps;

export const DefaultInfo = Template.bind({});

const defaultInfoProps: WalletPickerProps<any, any> = {
  ...defaultProps,
  DefaultInfo: ({ acknowledge }) => (
    <div>
      Welcome to the selector{" "}
      <button id="acknowledge" onClick={() => acknowledge()}>
        Continue
      </button>
    </div>
  ),
  config: {
    chains: {
      ethereum: [],
    },
  },
};

DefaultInfo.args = defaultInfoProps;

export const WrongNetworkInfo = Template.bind({});

const WrongNetworkInfoProps: WalletPickerProps<any, any> = {
  ...defaultProps,
  wrongNetwork: true,
  WrongNetworkInfo: ({ onClose }) => (
    <div>
      Custom wrong network component
      <button id="acknowledge" onClick={() => onClose()}>
        Close
      </button>
    </div>
  ),
  config: {
    chains: {
      ethereum: [],
    },
  },
};

WrongNetworkInfo.args = WrongNetworkInfoProps;

const ChildTemplate: Story<any> = (args) => (
  <WalletPicker {...args}>
    <div> Some extra Info</div>
  </WalletPicker>
);

export const InfoChild = ChildTemplate.bind({});

const infoChildProps: WalletPickerProps<any, any> = {
  ...defaultProps,
  config: {
    chains: {
      ethereum: [],
    },
  },
};

InfoChild.args = infoChildProps;

const usePickerStyles = makeStyles({
  root: {
    maxWidth: 500,
    minWidth: 380,
  },
  header: {
    backgroundColor: "#343434",
    color: "#fafafa",
    display: "flex",
    justifyContent: "space-between",
  },
});

const useWalletStyles = makeStyles((t) => ({
  body: {
    padding: t.spacing(2),
    flexGrow: 1,
    borderRadius: t.spacing(2),
    backgroundColor: "#444444",
  },
}));

const StyledTemplate: Story<any> = (args) => {
  const pickerClasses = usePickerStyles();
  const walletClasses = useWalletStyles();
  return (
    <WalletPicker
      walletClasses={walletClasses}
      pickerClasses={pickerClasses}
      {...args}
    />
  );
};

export const ClassExtension = StyledTemplate.bind({});

const classExtensionProps: WalletPickerProps<any, any> = {
  ...defaultProps,

  config: {
    chains: {
      ethereum: [
        {
          name: "metamask",
          logo: "https://avatars1.githubusercontent.com/u/11744586?s=60&v=4",
          connector: {} as any,
        },
      ],
    },
  },
};

ClassExtension.args = classExtensionProps;
